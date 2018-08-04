import { RobotController } from './robot';
import { fromEvent, merge, Observable } from 'rxjs';
import { filter, map, tap } from 'rxjs/operators';
import { VelocityTuner } from './velocityTuner';
import { Command } from './classifier';

export async function handleKeyEvent(
  robotName$: Observable<string>,
  velocityTuner: VelocityTuner
): Promise<void> {
  const [left, right] = await Promise.all(
    ['left', 'right'].map(wheel =>
      RobotController.createInstance(
        robotName$.pipe(map(robot => `${robot}/${wheel}`))
      )
    )
  );
  let controlling = false;
  merge(
    fromEvent(document, 'keydown').pipe(
      filter(() => !controlling),
      map(({ key }: KeyboardEvent) => {
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLSelectElement
        ) {
          return undefined;
        }
        switch (key) {
          case 'ArrowUp':
            return [Command.Forward, Command.Forward];
          case 'ArrowLeft':
            return [Command.Neutral, Command.Forward];
          case 'ArrowRight':
            return [Command.Forward, Command.Neutral];
          case 'ArrowDown':
            return [Command.Backward, Command.Backward];
        }
      }),
      filter(Boolean),
      tap(() => (controlling = true))
    ),
    fromEvent(document, 'keyup').pipe(
      filter(() => controlling),
      map(() => [Command.Neutral, Command.Neutral]),
      tap(() => (controlling = false))
    )
  ).subscribe(([leftCommand, rightCommand]) => {
    left.setVelocity(velocityTuner.getVelocity('left', leftCommand));
    right.setVelocity(velocityTuner.getVelocity('right', rightCommand));
  });
}
