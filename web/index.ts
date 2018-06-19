import * as tf from '@tensorflow/tfjs';
import { fromEvent, interval, asyncScheduler, merge } from 'rxjs';
import { switchMap, takeUntil, mapTo } from 'rxjs/operators';
import { Robot, RobotController, Wheel } from './robot';

const velocityInput = document.getElementById('velocityInput') as HTMLInputElement;
const sendButton = document.getElementById('sendButton') as HTMLButtonElement;

RobotController
  .createInstance(Robot.NOBUNAGA, Wheel.LEFT)
  .then(controller =>
    sendButton.addEventListener('click', async () =>
      await controller.setVelocity(Number(velocityInput.value) || 0)
    )
  )
  .catch(e => console.error(e));

const setupWebcamera = async (webcam: HTMLVideoElement) => {
  webcam.addEventListener('loadeddata', async () => {
    const { videoWidth, videoHeight } = webcam;
    const aspectRatio = videoWidth / videoHeight;

    if (videoWidth < videoHeight) {
      webcam.height = webcam.width / aspectRatio;
    } else {
      webcam.width = aspectRatio * webcam.height;
    }
  });

  try {
    const stream = await navigator
      .mediaDevices
      .getUserMedia({ video: true, audio: false });
    webcam.srcObject = stream;

  } catch (err) {
    console.error(err);
  }
};

const createPressStream = (el: Element) => fromEvent(el, 'mousedown')
  .pipe(
    switchMap(_ =>
      interval(0, asyncScheduler).pipe(
        takeUntil(fromEvent(window, 'mouseup'))
      )
    )
  );

enum Command {
  Neutral = 0,
  Forward = 1,
  Backward = 2
}

/**
 * Resize the given image tensor to a squred one.
 */
const cropImage = (image: tf.Tensor): tf.Tensor => {
  const [height, width] = image.shape;
  const size = Math.min(width, height);
  const start = [(height - size) / 2, (width - size) / 2, 0];
  const end = [size, size, 3];
  return image.slice(start, end);
};

const capture = (webcam: HTMLVideoElement): tf.Tensor => tf.tidy(() => {
  const webcamImage = tf.fromPixels(webcam);
  const cropped = cropImage(webcamImage);
  const expanded = cropped.expandDims();
  return expanded.toFloat().div(tf.scalar(127)).sub(tf.scalar(1));
});

let webcamera: HTMLVideoElement;

const setupUI = () => {
  webcamera = document.querySelector('#webcam') as HTMLVideoElement;
  setupWebcamera(webcamera);

  const neutralButton = document.querySelector('.neutral');
  const backwardButton = document.querySelector('.backward');
  const forwardButton = document.querySelector('.forward');

  const neutralPress$ = createPressStream(neutralButton!).pipe(mapTo(Command.Neutral));
  const backPress$ = createPressStream(backwardButton!).pipe(mapTo(Command.Backward));
  const forwardPress$ = createPressStream(forwardButton!).pipe(mapTo(Command.Forward));

  merge(backPress$, neutralPress$, forwardPress$)
    .subscribe(_label => {
      const image = capture(webcamera);
      console.log(image);
    });
};

(async () => {
  setupUI();
})();
