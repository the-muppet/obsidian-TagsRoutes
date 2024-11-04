declare module "obsidian" {
  interface App {
    workspace: Workspace;
    vault: Vault;
    metadataCache: MetadataCache;
  }

  interface Workspace {
    activeLeaf: WorkspaceLeaf;
    containerEl: HTMLElement;
    getLeavesOfType(type: string): WorkspaceLeaf[];
    getLeaf(split?: boolean): WorkspaceLeaf;
    setActiveLeaf(leaf: WorkspaceLeaf): void;
  }

  interface WorkspaceLeaf {
    view: View;
    openFile(file: TFile): Promise<void>;
  }

  interface View {
    containerEl: HTMLElement;
    getViewType(): string;
  }

  interface Vault {
    getAbstractFileByPath(path: string): TAbstractFile | null;
    createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
    getFiles(): TFile[];
    create(path: string, data: string): Promise<TFile>;
    process(file: TFile, fn: (data: string) => string): Promise<void>;
  }

  interface MetadataCache {
    getCache(path: string): CachedMetadata | null;
    resolvedLinks: Record<string, Record<string, number>>;
  }

  interface TFile extends TAbstractFile {
    path: string;
  }

  interface TAbstractFile {
    path: string;
  }

  interface CachedMetadata {
    frontmatter?: any;
    tags?: TagCache[];
  }

  interface TagCache {
    tag: string;
  }
} 