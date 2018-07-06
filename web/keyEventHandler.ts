import { RobotController } from './robot';
import { Observable } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

let handler: (e: KeyboardEvent) => any;

export async function handleKeyEvent(
  topic$: Observable<string>
): Promise<void> {
  const robotName$ = topic$.pipe(
    map(topic => topic.split('/')[0]),
    distinctUntilChanged(),
    shareReplay()
  );
  const [left, right] = await Promise.all(
    ['left', 'right'].map(wheel =>
      RobotController.createInstance(
        robotName$.pipe(map(robot => `${robot}/${wheel}`))
      )
    )
  );
  if (handler) {
    document.removeEventListener('keydown', handler);
  } else {
    console.table({
      '⬆️': {
        left: 'w',
        right: 'p'
      },
      '😐': {
        left: 's',
        right: 'l'
      },
      '⬇️': {
        left: 'x',
        right: ','
      }
    });
  }
  handler = ({ key }) => {
    switch (key) {
      case 'w':
        return left.setVelocity(1);
      case 's':
        return left.setVelocity(0);
      case 'x':
        return left.setVelocity(-1);
      case 'p':
        return right.setVelocity(1);
      case 'l':
        return right.setVelocity(0);
      case ',':
        return right.setVelocity(-1);
    }
  };
  document.addEventListener('keydown', handler);
}
