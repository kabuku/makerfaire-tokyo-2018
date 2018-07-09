import * as tf from '@tensorflow/tfjs';

import { CameraSide } from './camera';

export const enum Command {
  Backward = 0,
  Neutral = 1,
  Forward = 2
}

export const commandCount = 3;

export class Classifier {
  cameraSide: CameraSide;

  examples: { xs: any | null; ys: any | null } = {
    xs: null,
    ys: null
  };

  constructor(cameraSide: CameraSide) {
    this.cameraSide = cameraSide;
  }

  addExample = (label: Command, example: any) => {
    const y = tf.tidy(() => {
      return tf.oneHot(tf.tensor1d([label]).toInt(), commandCount);
    });
    if (this.examples.xs === null) {
      this.examples.xs = tf.keep(example);
      this.examples.ys = tf.keep(y);
    } else {
      const oldX = this.examples.xs;
      const oldY = this.examples.ys;

      this.examples.xs = tf.keep(oldX.concat(example));
      this.examples.ys = tf.keep(oldY.concat(y));

      oldX.dispose();
      oldY.dispose();
      y.dispose();
    }
  };

  resetAll() {
    if (this.examples.xs) {
      this.examples.xs.dispose();
      this.examples.ys.dispose();
      this.examples.xs = null;
      this.examples.ys = null;
    }
  }
}
