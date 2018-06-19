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

(async () => {
  const webcam = document.querySelector('#webcam') as HTMLVideoElement;
  setupWebcamera(webcam);
})();
