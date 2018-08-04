import { RobotName } from './robot';
import { BehaviorSubject, fromEvent } from 'rxjs';
import { Command } from './classifier';
import { map } from 'rxjs/operators';

const TUNING_KEY_PREFIX = 'velocity-tuning-';
const DEFAULT_VALUE = {
  left: { forward: 8, rotate: 7.1, backward: 6 },
  right: { forward: 6, rotate: 7.1, backward: 8 }
};

export class VelocityTuner {
  constructor(private readonly robotName$: BehaviorSubject<RobotName>) {
    const inputs: NodeListOf<HTMLInputElement> = document.querySelectorAll(
      '.velocity-tuning input'
    );
    robotName$.pipe(map(this.getStoredTuning)).subscribe(tuning => {
      for (const input of inputs) {
        const [wheel, direction] = input
          .getAttribute('data-target')!
          .split('-');
        input.value = tuning[wheel][direction];
      }
    });
    fromEvent(inputs, 'change').subscribe(() => {
      const tuning: any = {};
      for (const input of inputs) {
        const [wheel, direction] = input
          .getAttribute('data-target')!
          .split('-');
        if (!tuning[wheel]) {
          tuning[wheel] = {};
        }
        tuning[wheel][direction] = Number(input.value);
      }
      localStorage.setItem(
        TUNING_KEY_PREFIX + robotName$.getValue(),
        JSON.stringify(tuning)
      );
    });
  }

  getVelocity(command: Command): [number, number] {
    const tuning = this.getStoredTuning(this.robotName$.getValue());
    console.log(tuning);
    switch (command) {
      case Command.Forward:
        return [tuning.left.forward, tuning.right.forward];
      case Command.Rotate:
        return [tuning.left.rotate, tuning.right.rotate];
      case Command.Backward:
        return [tuning.left.backward, tuning.right.backward];
    }
  }

  private getStoredTuning = (robot: string): typeof DEFAULT_VALUE => {
    const stored = JSON.parse(localStorage.getItem(TUNING_KEY_PREFIX + robot)!);
    if (!stored) {
      return DEFAULT_VALUE;
    }
    return {
      left: { ...DEFAULT_VALUE.left, ...stored.left },
      right: { ...DEFAULT_VALUE.right, ...stored.right }
    };
  };
}
