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
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLSelectElement
        ) {
          return undefined;
        }
        switch (key) {
          case 'ArrowUp':
            return Command.Forward;
          case 'ArrowLeft':
          case 'ArrowRight':
            return Command.Rotate;
          case 'ArrowDown':
            return Command.Backward;
        }
      }),
      filter(command => typeof command === 'number'),
      map(command => velocityTuner.getVelocity(command!)),
      tap(() => (controlling = true))
    ),
    fromEvent(document, 'keyup').pipe(
      filter(() => controlling),
      map(() => [0, 0]),
      tap(() => (controlling = false))
    )
  ).subscribe(([leftVelocity, rightVelocity]) => {
    left.setVelocity(leftVelocity);
    right.setVelocity(rightVelocity);
  });
}
