import * as tf from '@tensorflow/tfjs';
import {
  combineLatest,
  fromEvent,
  merge,
  interval,
  Observable,
  BehaviorSubject
} from 'rxjs';
import {
  map,
  mapTo,
  switchMap,
  takeUntil,
  debounceTime,
  distinctUntilChanged,
  tap,
  shareReplay
} from 'rxjs/operators';

import { RobotController } from './robot';
import { CameraSide, setupCamera, capture } from './camera';
import { Command, Classifier, ModelStatus, ControlStatus } from './classifier';
import { loadMobilenet, createPressStream } from './helper';

import './styles.css';
import './pairplay.css';

let mobilenet: tf.Model;
let robotName: BehaviorSubject<string>;
let robotControllerLeft: RobotController;
let robotControllerRight: RobotController;
let classifierLeft: Classifier;
let classifierRight: Classifier;
let videoLeft: HTMLVideoElement;
let videoRight: HTMLVideoElement;

const setEnable = (elem: Element, enabled: boolean) => {
  if (enabled) {
    elem.removeAttribute('disabled');
  } else {
    elem.setAttribute('disabled', 'true');
  }
};

const setupCommandControl = (
  cameraSide: CameraSide,
  trainButton: Element
): Observable<{ trained: boolean; started: boolean }> => {
  let side: string;
  let video: HTMLVideoElement;
  let classifier: Classifier;

  switch (cameraSide) {
    case CameraSide.Left:
      side = '.left';
      video = videoLeft;
      classifier = classifierLeft;
      break;
    case CameraSide.Right:
      side = '.right';
      video = videoRight;
      classifier = classifierRight;
      break;
    default:
      throw new Error('camera side is invalid.');
  }

  const neutralCount = document.querySelector(`${side} .neutral .count`)!;
  const forwardCount = document.querySelector(`${side} .forward .count`)!;
  const backwardCount = document.querySelector(`${side} .backward .count`)!;

  classifier.exampleCounts$.subscribe(([bw, ne, fw]) => {
    backwardCount.textContent = `${bw}`;
    neutralCount.textContent = `${ne}`;
    forwardCount.textContent = `${fw}`;
  });

  const neutralButton = document.querySelector(`${side} .neutral button`)!;
  const forwardButton = document.querySelector(`${side} .forward button`)!;
  const backwardButton = document.querySelector(`${side} .backward button`)!;

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
        const image = capture(video, cameraSide);
        const example = mobilenet.predict(image);
        return { label, example };
      })
    )
    .subscribe(({ label, example }) => {
      classifier.addExample(label, example);
    });

  const addExampleButtons = [backwardButton, neutralButton, forwardButton];

  classifier.predictionResult$.subscribe(result => {
    addExampleButtons.forEach(b => b.removeAttribute('predicted'));

    if (result !== null) {
      const button = addExampleButtons[result];
      button.setAttribute('predicted', 'true');
    }
  });

  return combineLatest(classifier.modelStatus$, classifier.controlStatus$).pipe(
    map(([modelStatus, controlStatus]) => {
      const trainable =
        modelStatus !== ModelStatus.Preparing &&
        modelStatus !== ModelStatus.Training;
      addExampleButtons.forEach(b => setEnable(b, trainable));
      setEnable(
        trainButton,
        trainable && controlStatus === ControlStatus.Stopped
      );
      return {
        trained: modelStatus === ModelStatus.Trained,
        started: controlStatus === ControlStatus.Started
      };
    })
  );
};

const setupLogMessage = (cameraSide: CameraSide) => {
  let side: string;
  let classifier: Classifier;
  switch (cameraSide) {
    case CameraSide.Left:
      side = '.left';
      classifier = classifierLeft;
      break;
    case CameraSide.Right:
      side = '.right';
      classifier = classifierRight;
      break;
    default:
      throw new Error('camera side is invalid.');
  }

  const logMessage = document.querySelector(`.log-message${side}`)!;
  const status$ = classifier.modelStatus$;
  const lossRate$ = classifier.lossRate$;

  combineLatest(status$, lossRate$).subscribe(([status, lossRate]) => {
    let message = '';
    let loss = lossRate || 0;

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
};

const setupUI = async () => {
  videoLeft = document.querySelector(
    '.webcam-box.left video'
  ) as HTMLVideoElement;

  videoRight = document.querySelector(
    '.webcam-box.right video'
  ) as HTMLVideoElement;

  const cameraSelector = document.querySelector(
    '#camera-selector'
  ) as HTMLSelectElement;

  await setupCamera({
    targets: [videoLeft, videoRight],
    selector: cameraSelector,
    option: { width: 448, height: 224 }
  });

  // workaround
  const image = capture(videoLeft, CameraSide.Left);
  mobilenet.predict(image);

  const trainLeftButton = document.querySelector('.train-left')!;
  const trainRightButton = document.querySelector('.train-right')!;
  const startPredictButton = document.querySelector('.start-predict')!;
  const stopPredictButton = document.querySelector('.stop-predict')!;

  const trainLeftClick$ = fromEvent(trainLeftButton, 'click');
  const trainRightClick$ = fromEvent(trainRightButton, 'click');
  const startClick$ = fromEvent(startPredictButton, 'click');
  const stopClick$ = fromEvent(stopPredictButton, 'click');

  trainLeftClick$.subscribe(() => classifierLeft.startTraining());
  trainRightClick$.subscribe(() => classifierRight.startTraining());

  combineLatest(
    setupCommandControl(CameraSide.Left, trainLeftButton),
    setupCommandControl(CameraSide.Right, trainRightButton)
  ).subscribe(([left, right]) => {
    setEnable(startPredictButton, left.trained && right.trained);
    const started = left.started && right.started;
    startPredictButton.classList.toggle('hidden', started);
    stopPredictButton.classList.toggle('hidden', !started);
  });

  setupLogMessage(CameraSide.Left);
  setupLogMessage(CameraSide.Right);

  const predictionInterval$ = startClick$.pipe(
    tap(_ => {
      classifierLeft.setControlStatus(ControlStatus.Started);
      classifierRight.setControlStatus(ControlStatus.Started);
    }),
    switchMap(_ => interval(100).pipe(takeUntil(stopClick$))),
    shareReplay()
  );

  predictionInterval$.subscribe(async () => {
    const imageLeft = capture(videoLeft, CameraSide.Left);
    await classifierLeft.predict(imageLeft, mobilenet);
  });

  predictionInterval$.subscribe(async () => {
    const imageRight = capture(videoRight, CameraSide.Right);
    await classifierRight.predict(imageRight, mobilenet);
  });

  stopClick$.subscribe(() => {
    robotControllerLeft.setVelocity(0);
    robotControllerRight.setVelocity(0);
    classifierLeft.clearPrediction();
    classifierRight.clearPrediction();
    classifierLeft.setControlStatus(ControlStatus.Stopped);
    classifierRight.setControlStatus(ControlStatus.Stopped);
  });

  const webcamBoxLeft = document.querySelector('.webcam-box.left')!;
  const webcamBoxRight = document.querySelector('.webcam-box.right')!;

  classifierLeft.controlStatus$.subscribe(status => {
    if (status === ControlStatus.Started) {
      webcamBoxLeft.classList.add('blink');
    } else {
      webcamBoxLeft.classList.remove('blink');
    }
  });

  classifierRight.controlStatus$.subscribe(status => {
    if (status === ControlStatus.Started) {
      webcamBoxRight.classList.add('blink');
    } else {
      webcamBoxRight.classList.remove('blink');
    }
  });

  const robotNameInput = document.querySelector(
    '.robot-name'
  ) as HTMLInputElement;

  robotNameInput.value = robotName.value;

  fromEvent<Event>(robotNameInput, 'change')
    .pipe(
      tap(_ => robotNameInput.blur()),
      map(_ => robotNameInput.value)
    )
    .subscribe(robotName);
};

(async () => {
  robotName = new BehaviorSubject('nobunaga');

  const leftTopic$ = robotName.pipe(map(name => `${name}/left`));
  const rightTopic$ = robotName.pipe(map(name => `${name}/right`));

  [mobilenet, robotControllerLeft, robotControllerRight] = await Promise.all([
    loadMobilenet(),
    RobotController.createInstance(leftTopic$),
    RobotController.createInstance(rightTopic$)
  ]);

  classifierLeft = new Classifier();
  classifierRight = new Classifier();

  classifierLeft.predictionResult$
    .pipe(
      debounceTime(150),
      distinctUntilChanged()
    )
    .subscribe(label => {
      if (label !== null) {
        const velocity = label - 1; // label to velocity
        robotControllerLeft.setVelocity(velocity);
      }
    });
  classifierRight.predictionResult$
    .pipe(
      debounceTime(150),
      distinctUntilChanged()
    )
    .subscribe(label => {
      if (label !== null) {
        const velocity = label - 1; // label to velocity
        robotControllerRight.setVelocity(velocity);
      }
    });

  await setupUI();

  classifierLeft.setReady();
  classifierRight.setReady();
})().catch(err => console.error(err));
