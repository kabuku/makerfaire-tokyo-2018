import { MqttClient } from 'mqtt';
import { Observable, Subject } from 'rxjs';
import { distinctUntilChanged, scan, withLatestFrom } from 'rxjs/operators';

export class RobotController {
  private velocity$ = new Subject<number>();

  constructor(client: MqttClient, topic$: Observable<string>) {
    this.velocity$
      .pipe(withLatestFrom(topic$))
      .subscribe(([velocity, topic]) =>
        client.publish(topic, velocity.toString(), { qos: 1 })
      );
  }

  setVelocity(velocity: number): void {
    this.velocity$.next(velocity);
  }
}

const CONNECTION_TOPIC_REGEXP = /^([^/]+)\/connection/;
export function observeConnection(client: MqttClient): Observable<RobotName[]> {
  client.subscribe('+/connection', { qos: 1 });
  const update$ = new Subject<(robots: RobotName[]) => RobotName[]>();
  client.on('message', (topic, payload) => {
    const robot = topic.match(CONNECTION_TOPIC_REGEXP)![1] as RobotName;
    update$.next(
      (robots: RobotName[]) =>
        Number(payload.toString())
          ? robots.indexOf(robot) < 0
            ? [...robots, robot].sort()
            : robots
          : robots.filter(_robot => _robot !== robot)
    );
  });
  return update$.pipe(
    scan<(robots: RobotName[]) => RobotName[], RobotName[]>(
      (curr, updater) => updater(curr),
      []
    ),
    distinctUntilChanged(
      (a, b) => a.length === b.length && a.every((e, i) => e === b[i])
    )
  );
}

export enum RobotName {
  Nobunaga = 'nobunaga',
  Shingen = 'shingen',
  Xavier = 'xavier',
  Perry = 'perry',
  Shizuka = 'shizuka' // for test mode
}
