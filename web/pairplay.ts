import * as tf from '@tensorflow/tfjs';
import { combineLatest, fromEvent, merge, interval, from, of } from 'rxjs';
import {
  map,
  mapTo,
  switchMap,
  takeUntil,
  flatMap,
  debounceTime,
  distinctUntilChanged
} from 'rxjs/operators';

import { RobotController } from './robot';
import { CameraSide, setupCamera, capture } from './camera';
import { Command, Classifier, ModelStatus } from './classifier';
import { loadMobilenet, createPressStream } from './helper';

import './styles.css';
import './pairplay.css';

let mobilenet: tf.Model;
let robotControllerLeft: RobotController;
let robotControllerRight: RobotController;
let classifierLeft: Classifier;
let classifierRight: Classifier;
let videoLeft: HTMLVideoElement;
let videoRight: HTMLVideoElement;

const setupCommandControl = (cameraSide: CameraSide) => {
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

  const setEnable = (elem: Element, enabled: boolean) => {
    if (enabled) {
      elem.removeAttribute('disabled');
    } else {
      elem.setAttribute('disabled', 'true');
    }
  };

  classifier.modelStatus$.subscribe(status => {
    switch (status) {
      case ModelStatus.Preparing:
        addExampleButtons.forEach(b => setEnable(b, false));
        break;
      case ModelStatus.Ready:
        addExampleButtons.forEach(b => setEnable(b, true));
        break;
    }
  });
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
      case ModelStatus.Predict:
        if (loss) {
          message = `Running: Loss = ${loss.toFixed(5)}`;
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

  setupCommandControl(CameraSide.Left);
  setupCommandControl(CameraSide.Right);

  setupLogMessage(CameraSide.Left);
  setupLogMessage(CameraSide.Right);

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

  startClick$
    .pipe(
      switchMap(_ => interval(100).pipe(takeUntil(stopClick$))),
      flatMap(_ =>
        merge(
          from(classifierLeft.predict(videoLeft, mobilenet)),
          from(classifierRight.predict(videoRight, mobilenet))
        )
      )
    )
    .subscribe();

  stopClick$.subscribe(() => {
    robotControllerLeft.setVelocity(0);
    robotControllerRight.setVelocity(0);
    classifierLeft.initialize();
    classifierRight.initialize();
  });
};

(async () => {
  const robotName = 'nobunaga';

  [mobilenet, robotControllerLeft, robotControllerRight] = await Promise.all([
    loadMobilenet(),
    RobotController.createInstance(of(`${robotName}/left`)),
    RobotController.createInstance(of(`${robotName}/right`))
  ]);

  classifierLeft = new Classifier(CameraSide.Left);
  classifierRight = new Classifier(CameraSide.Right);

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

  classifierLeft.initialize();
  classifierRight.initialize();
})().catch(err => console.error(err));
