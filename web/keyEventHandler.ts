import { RobotController } from './robot';

let handler: (e: KeyboardEvent) => any;

export function handleKeyEvent(robotController: RobotController): void {
  if (handler) {
    document.removeEventListener('keydown', handler);
  }
  handler = ({ key }) => {
    console.log(key);
    switch (key) {
      case ' ':
      case 'Spacebar':
        return robotController.setVelocity(0);
      case 'Up':
      case 'ArrowUp':
        return robotController.setVelocity(1);
      case 'Down':
      case 'ArrowDown':
        return robotController.setVelocity(-1);
    }
  };
  document.addEventListener('keydown', handler);
}
