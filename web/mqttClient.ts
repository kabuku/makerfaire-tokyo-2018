import { connect, MqttClient } from 'mqtt';

export function getMqttClient(): Promise<MqttClient> {
  const client = connect(`mqtt://${location.hostname}:9001`);
  return new Promise((resolve, reject) =>
    client
      .on('connect', () => {
        console.log('MQTT connected');
        resolve(client);
      })
      .on('error', err => reject(err))
  );
}
