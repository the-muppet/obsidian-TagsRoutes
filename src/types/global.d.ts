interface HTMLElement {
  addClass(cls: string): void;
  removeClass(cls: string): void;
  addClasses(classes: string[]): void;
  removeClasses(classes: string[]): void;
  createEl<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: any): HTMLElementTagNameMap[K];
  createDiv(cls?: string): HTMLDivElement;
}

interface Document {
  createEl<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: any): HTMLElementTagNameMap[K];
}

interface String {
  padStart(targetLength: number, padString?: string): string;
} 