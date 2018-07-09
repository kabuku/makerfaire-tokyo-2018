import * as tf from '@tensorflow/tfjs';
import { merge, fromEvent } from 'rxjs';
import { mapTo, map } from 'rxjs/operators';

import { CameraSide, setupCamera, capture } from './camera';
import { Command, Classifier } from './classifier';
import { loadMobilenet, createPressStream } from './helper';

import './styles.css';
import './pairplay.css';

let mobilenet: tf.Model;
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

  setupCommandControl(CameraSide.Left);
  setupCommandControl(CameraSide.Right);

  // const startPredictButton = document.querySelector('.start-predict')!;
  const stopPredictButton = document.querySelector('.stop-predict')!;

  // const startClick$ = fromEvent(startPredictButton, 'click');
  const stopClick$ = fromEvent(stopPredictButton, 'click');

  stopClick$.subscribe(() => {
    classifierLeft.resetAll();
    classifierRight.resetAll();
  });
};

(async () => {
  mobilenet = await loadMobilenet();

  classifierLeft = new Classifier(CameraSide.Left);
  classifierRight = new Classifier(CameraSide.Right);

  await setupUI();
})().catch(err => console.error(err));
