import { fromEvent, interval, asyncScheduler, merge } from 'rxjs';
import { switchMap, takeUntil, map, mapTo } from 'rxjs/operators';
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
  Neutral = 'neutral',
  Forward = 'forword',
  Backward = 'backword'
}

const setupUI = () => {
  const backwardButton = document.querySelector('.backward');
  const neutralButton = document.querySelector('.neutral');
  const forwardButton = document.querySelector('.forward');

  const backPress$ = createPressStream(backwardButton).pipe(mapTo(Command.Backward));
  const neutralPress$ = createPressStream(neutralButton).pipe(mapTo(Command.Neutral));
  const forwardPress$ = createPressStream(forwardButton).pipe(mapTo(Command.Forward));

  merge(backPress$, neutralPress$, forwardPress$)
    .subscribe(console.log);
};

(async () => {
  setupUI();
  const webcam = document.querySelector('#webcam') as HTMLVideoElement;
  setupWebcamera(webcam);
})();
