import { connect, MqttClient } from 'mqtt';
import { Observable, Subject } from 'rxjs';
import { withLatestFrom } from 'rxjs/operators';

export class RobotController {
  private velocity$ = new Subject<number>();

  private constructor(client: MqttClient, topic$: Observable<string>) {
    this.velocity$
      .pipe(withLatestFrom(topic$))
      .subscribe(([velocity, topic]) =>
        client.publish(topic, velocity.toString(), { qos: 1 })
      );
  }

  static createInstance(topic$: Observable<string>): Promise<RobotController> {
    const client = connect(`mqtt://${location.hostname}:9001`);
    return new Promise((resolve, reject) =>
      client
        .on('connect', () => {
          console.log('MQTT connected');
          resolve(new RobotController(client, topic$));
        })
        .on('error', err => reject(err))
    );
  }

  setVelocity(velocity: number): void {
    this.velocity$.next(velocity);
  }
}

export enum RobotName {
  Nobunaga = 'nobunaga',
  Shingen = 'shingen',
  Xavier = 'xavier',
  Perry = 'perry',
  Shizuka = 'shizuka' // for test mode
}
