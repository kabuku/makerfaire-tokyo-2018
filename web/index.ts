import * as tf from '@tensorflow/tfjs';
import {
  from,
  fromEvent,
  interval,
  merge,
  BehaviorSubject,
  combineLatest,
  Observable
} from 'rxjs';
import {
  flatMap,
  switchMap,
  takeUntil,
  mapTo,
  map,
  startWith,
  distinctUntilChanged,
  debounceTime,
  filter
} from 'rxjs/operators';
import { RobotController } from './robot';
import { createTopic$ } from './topic';
import { handleKeyEvent } from './keyEventHandler';
import { CameraSide, setupCamera, capture } from './camera';
import { Command, ModelStatus, Classifier, ControlStatus } from './classifier';
import { createPressStream, loadMobilenet } from './helper';

import './styles.css';
import './oneside.css';

let topic$: Observable<string>;
let robotController: RobotController;
let mobilenet: tf.Model;
let webcamera: HTMLVideoElement;

const activeCameraSideSubject = new BehaviorSubject<CameraSide>(
  CameraSide.Left
);
let classifier: Classifier;

const setupUI = async () => {
  webcamera = document.querySelector('#webcam') as HTMLVideoElement;
  await setupCamera({
    targets: [webcamera],
    selector: document.getElementById('camera-selector') as HTMLSelectElement,
    option: { width: 448, height: 224 }
  });

  // workaround
  const image = capture(webcamera, CameraSide.Left);
  mobilenet.predict(image);

  const webcamBox = document.querySelector('.webcam-box')!;

  const neutralButton = document.querySelector('.neutral button')!;
  const forwardButton = document.querySelector('.forward button')!;
  const backwardButton = document.querySelector('.backward button')!;
  const addExampleButtons = [backwardButton, neutralButton, forwardButton];

  const neutralCount = document.querySelector('.neutral .count')!;
  const forwardCount = document.querySelector('.forward .count')!;
  const backwardCount = document.querySelector('.backward .count')!;

  const neutralScore = document.querySelector('.scores .neutral')!;
  const forwardScore = document.querySelector('.scores .forward')!;
  const backwardScore = document.querySelector('.scores .backward')!;

  const trainButton = document.querySelector('.train')!;
  const startPredictButton = document.querySelector('.start-predict')!;
  const stopPredictButton = document.querySelector('.stop-predict')!;
  const logMessage = document.querySelector('.log-message')!;

  const neutralPress$ = createPressStream(neutralButton).pipe(
    mapTo(Command.Neutral)
  );
  const forwardPress$ = createPressStream(forwardButton).pipe(
    mapTo(Command.Forward)
  );
  const backPress$ = createPressStream(backwardButton).pipe(
    mapTo(Command.Backward)
  );

  merge(backPress$, neutralPress$, forwardPress$)
    .pipe(
      map(label => {
        const activeSide = activeCameraSideSubject.value;
        const image = capture(webcamera, activeSide);
        const example = mobilenet.predict(image);
        return { label, example };
      })
    )
    .subscribe(({ label, example }) => {
      classifier.addExample(label, example);
    });

  classifier.exampleCounts$.subscribe(([bw, ne, fw]) => {
    backwardCount.textContent = `${bw}`;
    neutralCount.textContent = `${ne}`;
    forwardCount.textContent = `${fw}`;
  });

  const trainClick$ = fromEvent(trainButton, 'click');
  trainClick$.subscribe(_ => classifier.startTraining());

  const startClick$ = fromEvent(startPredictButton, 'click');
  const stopClick$ = fromEvent(stopPredictButton, 'click');

  startClick$
    .pipe(
      map(_ => classifier.setControlStatus(ControlStatus.Started)),
      switchMap(_ => interval(100).pipe(takeUntil(stopClick$))),
      flatMap(_ => from(classifier.predict(webcamera, mobilenet)))
    )
    .subscribe();

  classifier.predictionResult$.subscribe(result => {
    addExampleButtons.forEach(b => b.removeAttribute('predicted'));
    if (result !== null) {
      const button = addExampleButtons[result];
      button.setAttribute('predicted', 'true');
    }
  });

  classifier.predictionResult$
    .pipe(
      debounceTime(150),
      distinctUntilChanged()
    )
    .subscribe(label => {
      if (label !== null) {
        const velocity = label - 1; // label to velocity
        robotController.setVelocity(velocity);
      }
    });

  classifier.predictionScores$
    .pipe(filter(Boolean))
    .subscribe((scores: number[]) => {
      const [backward, neutral, forward] = scores.map(n => n.toFixed(3));
      backwardScore.textContent = backward;
      neutralScore.textContent = neutral;
      forwardScore.textContent = forward;
    });

  activeCameraSideSubject.subscribe(side => {
    classifier.setCameraSide(side);
    webcamBox.classList.remove('left');
    webcamBox.classList.remove('right');

    switch (side) {
      case CameraSide.Left:
        webcamBox.classList.add('left');
        return;
      case CameraSide.Right:
        webcamBox.classList.add('right');
        return;
    }
  });

  stopClick$.subscribe(_ => {
    robotController.setVelocity(0);
    classifier.clearPrediction();
    classifier.setControlStatus(ControlStatus.Stopped);
  });

  fromEvent(window, 'hashchange')
    .pipe(
      map(() => window.location.hash),
      startWith(window.location.hash)
    )
    .subscribe(hash => {
      if (hash) {
        const [, side] = hash.slice(1).split('/');
        activeCameraSideSubject.next(
          side === 'right' ? CameraSide.Right : CameraSide.Left
        );
      }
    });

  // Setup button status;

  const setEnable = (elem: Element, enabled: boolean) => {
    if (enabled) {
      elem.removeAttribute('disabled');
    } else {
      elem.setAttribute('disabled', 'true');
    }
  };

  combineLatest(classifier.modelStatus$, classifier.controlStatus$).subscribe(
    ([modelStatus, controlStatus]) => {
      const trainable =
        modelStatus !== ModelStatus.Preparing &&
        modelStatus !== ModelStatus.Training;
      addExampleButtons.forEach(b => setEnable(b, trainable));
      setEnable(
        trainButton,
        trainable && controlStatus === ControlStatus.Stopped
      );
      setEnable(startPredictButton, modelStatus === ModelStatus.Trained);
      startPredictButton.classList.toggle(
        'hidden',
        controlStatus === ControlStatus.Started
      );
      stopPredictButton.classList.toggle(
        'hidden',
        controlStatus === ControlStatus.Stopped
      );
    }
  );

  // Setup log message
  combineLatest(
    classifier.modelStatus$.pipe(distinctUntilChanged()),
    classifier.lossRate$
  ).subscribe(([status, loss]) => {
    let message = '';
    switch (status) {
      case ModelStatus.Preparing:
        message = 'Prepareing...';
        break;
      case ModelStatus.Training:
        if (loss) {
          message = `Training: Loss = ${loss.toFixed(5)}`;
        }
        break;
      case ModelStatus.Trained:
        if (loss) {
          message = `Done: Loss = ${loss.toFixed(5)}`;
        }
        break;
    }
    logMessage.textContent = message;
  });

  classifier.controlStatus$.subscribe(status => {
    if (status === ControlStatus.Started) {
      webcamBox.classList.add('blink');
    } else {
      webcamBox.classList.remove('blink');
    }
  });
};

window.onload = () => {
  const hash = window.location.hash.slice(1);
  if (!hash) {
    window.location.hash = '#nobunaga/left'; // Navigate to left controll by default
  }
};

(async () => {
  topic$ = createTopic$(window);
  const targetSelectors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('#target-selector a')
  );
  topic$.subscribe(topic => {
    targetSelectors.forEach(a => {
      if (a.getAttribute('href') === `#${topic}`) {
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
    });
  });

  [robotController, mobilenet] = await Promise.all([
    RobotController.createInstance(topic$),
    loadMobilenet(),
    handleKeyEvent(topic$)
  ]);
  classifier = new Classifier();
  await setupUI();
  classifier.setReady();
})().catch(err => console.error(err));
