import { RobotController } from './robot';
import { fromEvent, merge, Observable } from 'rxjs';
import { filter, map, tap } from 'rxjs/operators';
import { VelocityTuner } from './velocityTuner';
import { Command } from './classifier';
import { MqttClient } from 'mqtt';

export function handleKeyEvent(
  mqttClient: MqttClient,
  robotName$: Observable<string>,
  velocityTuner: VelocityTuner
): void {
  const [left, right] = ['left', 'right'].map(
    wheel =>
      new RobotController(
        mqttClient,
        robotName$.pipe(map(robot => `${robot}/${wheel}`))
      )
  );
  let controlling = false;
  merge(
    fromEvent(document, 'keydown').pipe(
      filter(() => !controlling),
      map(({ key }: KeyboardEvent) => {
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
