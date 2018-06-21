import { connect, MqttClient } from 'mqtt';
import { combineLatest, Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

export class RobotController {
  static createInstance(topic$: Observable<string>): Promise<RobotController> {
    const client = connect(`mqtt://${location.hostname}:9001`);
    return new Promise((resolve, reject) => client
      .on('connect', () => {
        console.log('MQTT connected');
        resolve(new RobotController(client, topic$));
      })
      .on('error', err => reject(err))
    );
  }

  private velocity$ = new Subject<number>();

  private constructor(client: MqttClient, topic$: Observable<string>) {
    combineLatest(topic$, this.velocity$)
      .pipe(map(([topic, velocity]) => client.publish(topic, velocity.toString())))
      .subscribe();
  }

  setVelocity(velocity: number): void {
    this.velocity$.next(velocity);
  }
}
