declare module 'three' {
  export class Vector2 {
    constructor(x?: number, y?: number);
  }

  export class LineSegments {}
  
  export class Group {}
  export class Mesh {}
  export class MeshBasicMaterial {}
  export class MeshStandardMaterial {}
  export class SphereGeometry {}
  export class BoxGeometry {}
  export class EdgesGeometry {}
  export class LineBasicMaterial {}
  export class DirectionalLight {}
  export class Scene {}
  export class Camera {}
}

declare module 'three/examples/jsm/postprocessing/UnrealBloomPass.js' {
  export class UnrealBloomPass {
    constructor(resolution: any, strength: number, radius: number, threshold: number);
  }
}

declare module 'three-spritetext' {
  export default class SpriteText {
    constructor(text: string);
    material: any;
    color: string;
    textHeight: number;
    position: any;
    visible: boolean;
    raycast(): void;
  }
} 