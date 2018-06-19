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
