declare module '3d-force-graph' {
  export interface ForceGraph3DInstance {
    graphData(): any;
    backgroundColor(color: string): ForceGraph3DInstance;
    nodeThreeObject(fn: (node: any) => any): ForceGraph3DInstance;
    linkColor(fn: (link: any) => string): ForceGraph3DInstance;
    linkWidth(fn: (link: any) => number): ForceGraph3DInstance;
    linkDirectionalParticles(fn: (link: any) => number): ForceGraph3DInstance;
    linkDirectionalParticleWidth(fn: (link: any) => number): ForceGraph3DInstance;
    nodeVisibility(fn: (node: any) => boolean): ForceGraph3DInstance;
    linkVisibility(fn: (link: any) => boolean): ForceGraph3DInstance;
    cameraPosition(pos: any): ForceGraph3DInstance;
    scene(): any;
    camera(): any;
    renderer(): any;
    postProcessingComposer(): any;
    d3Force(force: string): any;
    d3ReheatSimulation(): void;
  }

  export default function ForceGraph3D(): ForceGraph3DInstance;
} 