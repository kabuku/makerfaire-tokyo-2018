interface Face {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  landmarks: {
    type: string;
    location: {
      x: number;
      y: number;
    };
  }[];
}

declare class FaceDetector {
  detect(
    element: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
  ): Promise<Face[]>;
}
