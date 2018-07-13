import * as tf from '@tensorflow/tfjs';
import { fromEvent, interval } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';

const MODEL_URL = '/model.json';

export const loadMobilenet = async (): Promise<tf.Model> => {
  const mn = await tf.loadModel(MODEL_URL);
  const layer = mn.getLayer('conv_pw_13_relu');
  return tf.model({
    inputs: mn.input,
    outputs: layer.output
  });
};

export const createPressStream = (el: Element) =>
  fromEvent(el, 'mousedown').pipe(
    switchMap(_ => interval(10).pipe(takeUntil(fromEvent(window, 'mouseup'))))
  );
