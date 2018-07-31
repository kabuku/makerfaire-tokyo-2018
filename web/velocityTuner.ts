import { RobotName } from './robot';
import { fromEvent, BehaviorSubject } from 'rxjs';
import { Command } from './classifier';
import { map } from 'rxjs/operators';

const TUNING_KEY_PREFIX = 'velocity-tuning-';
const DEFAULT_VALUE = {
  left: { forward: 8, backward: 6 },
  right: { forward: 6, backward: 8 }
};

export class VelocityTuner {
  constructor(private readonly robotName$: BehaviorSubject<RobotName>) {
    const inputs: NodeListOf<HTMLInputElement> = document.querySelectorAll(
      '.velocity-tuning input'
    );
    robotName$
      .pipe(
        map(
          robot =>
            JSON.parse(localStorage.getItem(TUNING_KEY_PREFIX + robot)!) ||
            DEFAULT_VALUE
        )
      )
      .subscribe(tuning => {
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

  getVelocity(wheel: 'left' | 'right', command: Command): number {
    if (command === Command.Neutral) {
      return 0;
    }
    const tuning =
      JSON.parse(
        localStorage.getItem(TUNING_KEY_PREFIX + this.robotName$.getValue())!
      ) || DEFAULT_VALUE;
    const velocities = tuning[wheel];
    if (command === Command.Forward) {
      return velocities.forward;
    } else {
      return velocities.backward;
    }
  }
}
