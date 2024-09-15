import { moment, MarkdownView, Notice, CachedMetadata, ValueComponent, Platform } from 'obsidian';
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import * as THREE from 'three';
import { getFileType, getTags, parseTagHierarchy, filterStrings, shouldRemove, setViewType, showFile } from "../util/util"
import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import * as d3 from 'd3-force-3d';
import { settingGroup } from "./settings"
import TagsRoutes, { defaltColorMap, DEFAULT_DISPLAY_SETTINGS, TagRoutesSettings } from '../main';
import { Vector2 } from 'three';
import SpriteText from 'three-spritetext';
export const VIEW_TYPE_TAGS_ROUTES = "tags-routes";
interface GraphData {
    nodes: ExtendedNodeObject[];
    links: LinkObject[];
}
interface Control {
    id: string;
    control: ValueComponent<any>;
}
// 自定义 LinkObject 类型
interface LinkObject {
    source: string | ExtendedNodeObject;
    target: string | ExtendedNodeObject;
    sourceId: string;  // 添加源ID字段
    targetId: string;  // 添加目标ID字段
}
interface nodeThreeObject extends ExtendedNodeObject {
    __threeObj?: THREE.Mesh
}
interface ExtendedNodeObject extends Node {
    type: 'markdown' | 'tag' | 'attachment' | 'broken' | 'pdf' | 'excalidraw' | 'other' | 'frontmatter-tag';
    x?: number;
    y?: number;
    z?: number;
    connections?: number; // 添加 connections 属性来存储连接数
    instanceNum?: number;
    size?: number;
    neighbors?: ExtendedNodeObject[];
    orphan?: boolean;
    links?: LinkObject[];
    _ThreeGroup?: THREE.Group;
    _ThreeMesh?: THREE.Mesh;
    _Sprite?: SpriteText;
}
interface Node {
    id: string;
    type: string;
}
// 创建 filesDataMap
const filesDataMap: Map<string, CachedMetadata | null> = new Map();
const logFilePath = 'TagsRoutes/logs/logMessage.md'

interface VisualStyle {
    // Name of the visual style
    name: string;
  
    // Plugin reference
    plugin: TagsRoutes;
  
    container: HTMLElement;
    // Method to add a visual style
    addStyle(container:HTMLElement): void;
  
    // Method to remove a visual style
    removeStyle(container:HTMLElement): void;

  }

class darkStyle implements VisualStyle {
    // Define the properties
    name: string;
    plugin: TagsRoutes;
    container: HTMLElement;
    bloomPass: UnrealBloomPass;
    Graph: ForceGraph3DInstance;
    // Constructor to initialize properties
    constructor(name: string, plugin: TagsRoutes) {
        this.name = name;
        this.plugin = plugin;
    }
    // Implement the addStyle method
    addStyle(container:HTMLElement): void {
        console.log(`Adding style: ${this.name}`);
        this.plugin.view.clearHightlightNodes();
        this.Graph = this.plugin.view.Graph;
        this.Graph.backgroundColor(this.plugin.settings.customSlot?.[0].colorMap.backgroundColor.value||"#000003")
        this.Graph.nodeThreeObject(this.plugin.view.createNodeThreeObject)
        this.Graph.lights()[0].intensity = 1.0;
        this.bloomPass = new (UnrealBloomPass)(({ x: container.clientWidth, y: container.clientHeight } as Vector2), 2.0, 1, 0)
        this.plugin.view.Graph.postProcessingComposer().addPass(this.bloomPass);
    }

    // Implement the removeStyle method
    removeStyle(container:HTMLElement): void {
        console.log(`Removing style: ${this.name}`);
        this.plugin.view.Graph.postProcessingComposer().removePass(this.bloomPass);
    }
}  

class lightStyle implements VisualStyle {
    // Define the properties
    name: string;
    plugin: TagsRoutes;
    container: HTMLElement;
    Graph: ForceGraph3DInstance;
    // Constructor to initialize properties
    constructor(name: string, plugin: TagsRoutes) {
        this.name = name;
        this.plugin = plugin;
    }

    // Implement the addStyle method
    addStyle(container: HTMLElement): void {
        console.log(`Adding style: ${this.name}`);
        this.plugin.view.clearHightlightNodes();
        this.Graph = this.plugin.view.Graph;
        this.Graph.backgroundColor(this.plugin.settings.customSlot?.[0].colorMap.backgroundColor.value || "#ffffff")
        this.Graph.nodeThreeObject(this.plugin.view.createNodeThreeObjectLight)
        this.Graph.lights()[0].intensity = 0.2;// = false;//  = 1;
        const light = new THREE.DirectionalLight(0xffffff, 1); // 强度降低
        light.position.set(5, 10, 7.5); // 设置光源位置
        light.castShadow = true;
        this.Graph.scene().add(light);
    }

    // Implement the removeStyle method
    removeStyle(container: HTMLElement): void {
        console.log(`Removing style: ${this.name}`);
        this.Graph.scene().remove(this.Graph.lights()[1]);
    }
}  


// 创建一个View 
export class TagRoutesView extends ItemView {
    plugin: TagsRoutes;
    public Graph: ForceGraph3DInstance;
    private gData: GraphData = {
        nodes: [],
        links: []
    };
    _controls: Control[] = [];
    container = this.containerEl.children[1];
    currentVisualString: "dark"|"light"|"" = "";
    currentSlotNum: number;
    visualProcessor: VisualStyle;
    visuals: {
        dark: VisualStyle;
        light: VisualStyle;
    }
    saveButtonRef= { value: null as HTMLElement | null };
    constructor(leaf: WorkspaceLeaf, plugin: TagsRoutes) {
        super(leaf);
        this.plugin = plugin;
        this.onLinkDistance = this.onLinkDistance.bind(this); // 手动绑定 this
        this.onNodeSize = this.onNodeSize.bind(this);
        this.onNodeRepulsion = this.onNodeRepulsion.bind(this);
        this.onLinkWidth = this.onLinkWidth.bind(this);
        this.onLinkParticleNumber = this.onLinkParticleNumber.bind(this);
        this.onLinkParticleSize = this.onLinkParticleSize.bind(this);
        this.onSlotSliderChange = this.onSlotSliderChange.bind(this)
        this.onToggleGlobalMap = this.onToggleGlobalMap.bind(this)
        this.getNodeVisible = this.getNodeVisible.bind(this)
        this.getLinkVisible = this.getLinkVisible.bind(this)
        this.onResetGraph = this.onResetGraph.bind(this);
        this.createNodeThreeObject = this.createNodeThreeObject.bind(this);
        this.currentSlotNum = this.plugin.settings.currentSlotNum;
        this.createNodeThreeObjectLight = this.createNodeThreeObjectLight.bind(this);
        this.updateColor = this.updateColor.bind(this);
        this.getNodeColorByType = this.getNodeColorByType.bind(this);
        this.switchTheme = this.switchTheme.bind(this);
        this.onToggleLabelDisplay = this.onToggleLabelDisplay.bind(this);
        this.setSaveButton = this.setSaveButton.bind(this);
        this.visuals = {
            dark: new darkStyle("dark", this.plugin),
            light: new lightStyle("light", this.plugin)
        }

        this.onDropdown = this.onDropdown.bind(this)
     //   this.createNodeThreeObject = this.createNodeThreeObject.bind(this)
        this.onLinkButton = this.onLinkButton.bind(this)
        this.onUnlinkButton = this.onUnlinkButton.bind(this)
        this.linkNodeByType = this.linkNodeByType.bind(this)
        this.unlinkNodeByType = this.unlinkNodeByType.bind(this)
     //   this.currentSlot = this.plugin.settings.currentSlot;
        this.applyNodeSize = this.applyNodeSize.bind(this)
        this.onToggleLabelDisplay = this.onToggleLabelDisplay.bind(this)
    }
    getViewType() {
        return VIEW_TYPE_TAGS_ROUTES;
    }
    getDisplayText() {
        return "Tags routes";
    }
    getIcon() {
        return "waypoints";
    }
    private hoveredNodes = new Set();
    private hoveredNodesLinks = new Set();
    private selectedNodes = new Set();
    private selectedNodesLinks = new Set();
    private highlightNodes = new Set();
    private highlightLinks = new Set();
    private hoverNode: ExtendedNodeObject | null;
    private selectedNode: ExtendedNodeObject | null;
    private orphanToLink: string = 'broken';


    getComputedColorForSelector(selector: string): string {
        // Create a temporary element
        const tempElement: HTMLElement = document.createElement('div');
        tempElement.style.display = 'none';
        
        // Apply the selector as a class name
        tempElement.className = selector.replace(/^\./, '').replace(/\./g,' '); // Remove leading dot if present
        // Append to body
        document.body.appendChild(tempElement);
        
        // Get computed style
        const computedStyle = window.getComputedStyle(tempElement);
        const color = computedStyle.color;
        
        // Remove the temporary element
        document.body.removeChild(tempElement);
        
        // Convert to hex and return
        return this.rgbToHex(color);
    }
    
    rgbToHex(color: string): string {
        if (color.startsWith('#')) {
            return color.slice(0, 7);
        }
        
        const parts = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(?:\d+(?:\.\d+)?))?\)$/);
        
        if (!parts) {
            throw new Error("Invalid color format");
        }
    
        const r = parseInt(parts[1]).toString(16).padStart(2, '0');
        const g = parseInt(parts[2]).toString(16).padStart(2, '0');
        const b = parseInt(parts[3]).toString(16).padStart(2, '0');
        
        return `#${r}${g}${b}`;
    }

    applyThemeColor() {
        if (!this.plugin.settings.customSlot) return;
        this.plugin.settings.customSlot[0].colorMap["markdown"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-fill")
        }
        this.plugin.settings.customSlot[0].colorMap["tag"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-fill-tag")
        }
        this.plugin.settings.customSlot[0].colorMap["attachment"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-fill-attachment")
        }
        this.plugin.settings.customSlot[0].colorMap["nodeFocusColor"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-fill-focused")
        }
        this.plugin.settings.customSlot[0].colorMap["nodeHighlightColor"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-fill-highlight")
        }
        this.plugin.settings.customSlot[0].colorMap["linkHighlightColor"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-line-highlight")
        }
        this.plugin.settings.customSlot[0].colorMap["linkNormalColor"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-line")
        }
        this.plugin.settings.customSlot[0].colorMap["broken"] = {
            name: "theme", value: this.getComputedColorForSelector(".graph-view.color-fill-unresolved")
        }
        this.clearHightlightNodes();
        if (this.currentVisualString === "light") {
            this.plugin.settings.customSlot[0].colorMap["backgroundColor"] = {
                name: "theme", value:
                    getComputedStyle(this.app.workspace.containerEl).getPropertyValue("--background-primary").toLowerCase()
            }
            this.Graph.backgroundColor(this.plugin.settings.customSlot[0].colorMap["backgroundColor"].value)
          //  this.Graph.nodeThreeObject(this.plugin.view.createNodeThreeObjectLight)
        } else if (this.currentVisualString === "dark") {
          //  this.Graph.nodeThreeObject(this.plugin.view.createNodeThreeObject)
        }
        this.updateColor();
        this.updateHighlight();
        const isDarkMode = document.body.classList.contains('theme-dark');
        //    const colorMapSource = `'${(this.app.vault as any)?.config?.cssTheme || "Obsidian"}${(this.app.vault as any)?.config?.cssTheme?" - "+(this.app.vault as any)?.config?.theme || "Unknow":""}' - ${isDarkMode ? 'dark' : 'light'} `
        const colorMapSource = `'${(this.app.vault as any)?.config?.cssTheme || "Obsidian"}' - ${isDarkMode ? 'dark' : 'light'} `
        this.plugin.settings.customSlot[0].colorMapSource = colorMapSource;
        console.log("current colormap: ", colorMapSource)
        new Notice(`Tags routes: Color imported from  ${colorMapSource}`);
        new Notice(`Tags routes: Use 'Save' to make the changes effective next time.`);
        this.setSaveButton(true)
    }
    setSaveButton(needSave: boolean) {
        if (this.saveButtonRef.value) {
            if (needSave) {
                this.saveButtonRef.value.addClass("need-save")
            }
            else {
                this.saveButtonRef.value.removeClass("need-save")
            }
        }
    }
    /*
        Make sure the customSlot has been swtiched to wanted theme before call this
    */
    async switchTheme(visual: 'dark' | 'light'):Promise<boolean> {
        if (this.currentVisualString !== visual) {
            this.visualProcessor?.removeStyle(this.container as HTMLElement);
            this.visualProcessor = this.visuals[visual]
            this.visualProcessor.addStyle(this.container as HTMLElement);
            this.currentVisualString = visual
            return true;
        }
        return false;
    }
    createNodeThreeObjectLight(node: ExtendedNodeObject,) {

        const group = new THREE.Group();

        let nodeSize = (node.connections || 1)
        if (node.type === 'tag') nodeSize = (node.instanceNum || 1)
        nodeSize = Math.log2(nodeSize) * 5;
        const geometry = new THREE.SphereGeometry(nodeSize < 3 ? 3 : nodeSize, 16, 16);
       // console.log("type of this: ", typeof(view))
        let color = this.getNodeColorByType(node);
        const material = new THREE.MeshBasicMaterial({ color });
        const material0 = new THREE.MeshStandardMaterial({
            color: color,
        //    blending: THREE.AdditiveBlending,
            
            emissive: color,
            emissiveIntensity: 0.3
        });
        material0.opacity = .9; //0.85;
        material0.transparent = true;
        const mesh = new THREE.Mesh(geometry, material0);
        group.add(mesh)
        const parts = node.id.split('/')

        let node_text_name = "";

        if (node.type == 'other') {
            node_text_name = node.id
        } else {
            if (node.type == 'tag') {
                node_text_name = parts[parts.length - 1]
            } else {
                let node_full_name = parts[parts.length - 1];
                let partsName = node_full_name.split('.')
                if (partsName.length > 1) {
                    partsName.length = partsName.length - (node.type === 'excalidraw' ? 2 : 1)
                }
                node_text_name = partsName.join('.')
            }
        }

        const sprite = new SpriteText(node_text_name + " (" + (node.type == 'tag' ? node.instanceNum : node.connections) + ')');


        sprite.material.depthWrite = false; // make sprite background transparent
        sprite.color = this.getNodeColorByType(node);
        sprite.visible = false;
        if (node.type === 'tag') sprite.color = '#CCCCCC'
        sprite.textHeight = 0;
        //sprite.scale.set(18, 18, 8); // 设置标签大小


        sprite.position.set(0, -nodeSize - 20, 0); // 将标签位置设置在节点上方
        group.add(sprite);
        sprite.raycast = () => { };

        node._ThreeGroup = group;
        node._ThreeMesh = mesh;
        node._Sprite = sprite;

        return group;
    }
    createNodeThreeObject(node: ExtendedNodeObject) {

        const group = new THREE.Group();

        let nodeSize = (node.connections || 1)
        if (node.type === 'tag') nodeSize = (node.instanceNum || 1)
        nodeSize = Math.log2(nodeSize) * 5;
        const geometry = new THREE.SphereGeometry(nodeSize < 3 ? 3 : nodeSize, 16, 16);
        let color = this.getNodeColorByType(node);
        const material = new THREE.MeshBasicMaterial({ color });
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh)
        const parts = node.id.split('/')

        let node_text_name = "";

        if (node.type == 'other') {
            node_text_name = node.id
        } else {
            if (node.type == 'tag') {
                node_text_name = parts[parts.length - 1]
            } else {
                let node_full_name = parts[parts.length - 1];
                let partsName = node_full_name.split('.')
                if (partsName.length > 1) {
                    partsName.length = partsName.length - (node.type === 'excalidraw' ? 2 : 1)
                }
                node_text_name = partsName.join('.')
            }
        }

        const sprite = new SpriteText(node_text_name + " (" + (node.type == 'tag' ? node.instanceNum : node.connections) + ')');


        sprite.material.depthWrite = false; // make sprite background transparent
        sprite.color = this.getNodeColorByType(node);
        sprite.visible = false;
        if (node.type === 'tag') sprite.color = '#ffffff'
        sprite.textHeight = 0;
        //sprite.scale.set(18, 18, 8); // 设置标签大小


        sprite.position.set(0, -nodeSize - 20, 0); // 将标签位置设置在节点上方
        group.add(sprite);
        sprite.raycast = () => { };

        node._ThreeGroup = group;
        node._ThreeMesh = mesh;
        node._Sprite = sprite;

        return group;
    }
    getCameraDistance(node: ExtendedNodeObject):number {
        let nodeSize = (node.connections || 1)
        const maxdistance = 640
        const minDistance = 150
        let distance = 640
        if (nodeSize < 10) {
          distance = minDistance + nodeSize/10  * (maxdistance - minDistance)
        }
        return distance
    }
    /**
     * Handle the highlight data change of a clicked node
     * @param node | null
     * 
     */
    highlightOnNodeClick(node: ExtendedNodeObject | null) {
        if (!this.plugin.settings.customSlot) return; 
        // no state change
        if ((!node && !this.selectedNodes.size) || (node && this.selectedNode === node)) return;
        if (this.plugin.settings.customSlot[0].toggle_global_map) {
            // the global map mode
            this.selectedNodes.clear();
            this.selectedNodesLinks.clear();
            this.selectedNode = node;
            if (node) {
                this.selectedNodes.add(node);
                if (node.neighbors) {
                    node.neighbors.forEach(neighbor => {
                        this.selectedNodes.add(neighbor)
                    });
                }
                if (node.links) {
                    node.links.forEach(link => {
                        this.selectedNodesLinks.add(link)
                    });
                }
            }
        } else {
            // the none global map mode
            if (!this.selectedNodes.has(node)) {
                this.selectedNodes.clear();
                this.selectedNodesLinks.clear();
                this.selectedNode = node;
                if (node) {
                    this.selectedNodes.add(node);
                    if (node.neighbors) {
                        node.neighbors.forEach(neighbor => {
                            this.selectedNodes.add(neighbor)
                        });
                    }
                    if (node.links) {
                        node.links.forEach(link => {
                            this.selectedNodesLinks.add(link)
                        });
                    }
                }
            }


        }

        this.updateHighlight();
    }
    highlightOnNodeRightClick(node: ExtendedNodeObject | null) {
        if (node) {
            this.selectedNodes.add(node);
            if (node.neighbors) {
                node.neighbors.forEach(neighbor => {
                    this.selectedNodes.add(neighbor)
                });
            }
            if (node.links) {
                node.links.forEach(link => {
                    this.selectedNodesLinks.add(link)
                });
            }
        }

        this.updateHighlight();
    }
    /**
     * Node will be null when hover ended
     * @param node 
     * @returns 
     */
    highlightOnNodeHover(node: ExtendedNodeObject | null) {
        // no state change
        if ((!node && !this.hoveredNodes.size) || (node && this.hoverNode === node)) return;
        this.hoverNode = node;
        this.hoveredNodes.clear();
        this.hoveredNodesLinks.clear();
        if (node) {
            this.hoveredNodes.add(node);
            if (node.neighbors) {
                node.neighbors.forEach(neighbor => {
                    this.hoveredNodes.add(neighbor)
                });
            }
            if (node.links) {
                node.links.forEach(link => {
                    this.hoveredNodesLinks.add(link)
                });
            }
        }
        this.updateHighlight();
    }
    onLinkHover(link: LinkObject) {
        this.hoveredNodes.clear();
        this.hoveredNodesLinks.clear();
        if (link) {
            this.hoveredNodesLinks.add(link);
            this.hoveredNodes.add(link.source);
            this.hoveredNodes.add(link.target);
        }
        this.updateHighlight();
    }
    getNodeVisible(node: any) {
        if (!this.plugin.settings.customSlot) return false; 
        if (this.plugin.settings.customSlot[0].toggle_global_map) return true;
        if (this.highlightNodes.size != 0) {
            return this.highlightNodes.has(node) ? true : false
        } else {
            return true
        };
    }
    getLinkVisible(link: any) {
        if (!this.plugin.settings.customSlot) return true; 
        if (this.plugin.settings.customSlot[0].toggle_global_map) return true;
        if (this.highlightLinks.size != 0 || this.selectedNode || this.hoverNode) {
            return this.highlightLinks.has(link) ? true : false
        } else {
            return true
        }
    }
    updateColor1() {
        //console.log("update color")
        if (!this.plugin.settings.customSlot) return;
        this.plugin.view.clearHightlightNodes();
        if (this.currentVisualString === "light") {
            this.Graph.nodeThreeObject(this.plugin.view.createNodeThreeObjectLight)
        } else if (this.currentVisualString === "dark") {
            this.Graph.nodeThreeObject(this.plugin.view.createNodeThreeObject)
        }
        this.Graph.backgroundColor(this.plugin.settings.customSlot[0].colorMap["backgroundColor"].value)
        this.Graph.linkColor(this.Graph.linkColor());
        return;
    }
    updateColor() {
        //console.log("update color")
        if (!this.plugin.settings.customSlot) return;
        this.Graph.graphData().nodes.forEach((node: nodeThreeObject) => {
            const color = this.getNodeColorByType(node);
            const obj = node._ThreeMesh; // 获取节点的 Three.js 对象
            if (obj) {
                if (this.currentVisualString === "dark") {
                    (obj.material as THREE.MeshBasicMaterial).color.set(color);
                } else {
                    (obj.material as THREE.MeshStandardMaterial).color.set(color);
                    (obj.material as THREE.MeshStandardMaterial).emissive.set(color);
                }
              //  return;
            }
            if (node._Sprite) {
                node._Sprite.color = color;
            }
        })
        this.Graph.backgroundColor(this.plugin.settings.customSlot[0].colorMap["backgroundColor"].value)
        //this.Graph.backgroundColor(this.plugin.settings?.customSlot?.[0].colorMap.backgroundColor.value||defaltColorMap[this.plugin.settings.currentTheme].backgroundColor.value)
        this.Graph.linkColor(this.Graph.linkColor());
    }
    updateHighlight() {
        
        // trigger update of highlighted objects in scene
        this.highlightNodes.clear();
        this.selectedNodes.forEach(node => this.highlightNodes.add(node));
        this.hoveredNodes.forEach(node => this.highlightNodes.add(node));
        this.highlightLinks.clear();
        this.selectedNodesLinks.forEach(link => this.highlightLinks.add(link));
        this.hoveredNodesLinks.forEach(link => this.highlightLinks.add(link));
        this.Graph.graphData().nodes.forEach((node: ExtendedNodeObject) => {
            const obj = node._ThreeMesh; // 获取节点的 Three.js 对象
            if (obj) {
                if (this.plugin.settings.customSlot) {
                    if (this.plugin.settings.customSlot[0].toggle_global_map) {
                        (obj.material as THREE.MeshBasicMaterial).color.set(this.getNodeColorByType(node));
                        obj.visible = true;
                    } else {
                        if (this.highlightNodes.has(node)) {
                            (obj.material as THREE.MeshBasicMaterial).color.set(this.getNodeColorByType(node));
                        }
                        obj.visible = this.getNodeVisible(node);
                    }
                }
            }
            if (node._Sprite && node._Sprite.visible) {

                node._Sprite.visible = false;
                node._Sprite.textHeight = 0;
            }
            const showSpriteText = this.plugin.settings.customSlot?.[0].toggle_label_display || false;
            if (this.highlightNodes.has(node) && node.type !== 'attachment' && node.type !== 'broken') {
                if (showSpriteText && node._Sprite) {
                    node._Sprite.visible = true;
                    node._Sprite.textHeight = 18;
                }
            } else {

            }
            
        }
        );
        if (this.hoverNode && this.hoverNode._Sprite) {
            this.hoverNode._Sprite.visible = true;
            this.hoverNode._Sprite.textHeight = 18;
        }

        this.Graph
            .linkWidth(this.Graph.linkWidth())
            .linkDirectionalParticles(this.Graph.linkDirectionalParticles())
            .linkVisibility(this.Graph.linkVisibility())
    }
    focusGraphNodeById(filePath: string) {
        // 获取 Graph 中的相应节点，并将视图聚焦到该节点
        const node = this.gData.nodes.find((node: ExtendedNodeObject) => node.id === filePath);
        if (node && node.x && node.y && node.z) {
            const distance = this.getCameraDistance(node)
            const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
            const newPos = {
                x: node.x * distRatio,
                y: node.y * distRatio,
                z: node.z * distRatio,
            };
            this.Graph.cameraPosition(newPos, node as any, 3000);
            this.highlightOnNodeClick(node)
        }
    }
    focusGraphTag(tag: string) {
        this.focusGraphNodeById(tag);
    }
    // 添加按钮
    createButton(buttonText: string, buttonClass: string, buttonCallback: () => void): HTMLElement {
        const button = document.createEl('div').createEl('button', { text: buttonText, cls: buttonClass });
        button.addEventListener('click', buttonCallback);
        return button;
    }
    onLinkDistance(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        this.Graph.d3Force('link')?.distance(value * 10);
        this.Graph.d3ReheatSimulation();
        this.plugin.settings.customSlot[0].link_distance = value
        this.plugin.saveSettings();
    }
    onLinkWidth(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        this.Graph.linkWidth((link: any) => this.highlightLinks.has(link) ? 2 * value : value)
        this.plugin.settings.customSlot[0].link_width = value
        this.plugin.saveSettings();
    }
    onLinkParticleNumber(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        this.Graph.linkDirectionalParticles((link: any) => this.highlightLinks.has(link) ? value * 2 : value)
        this.plugin.settings.customSlot[0].link_particle_number = value
        this.plugin.saveSettings();
    }
    onLinkParticleSize(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        this.Graph.linkDirectionalParticleWidth((link: any) => this.highlightLinks.has(link) ? value * 2 : value)
        this.plugin.settings.customSlot[0].link_particle_size = value
        this.plugin.saveSettings();
    }
    onToggleLabelDisplay(value: boolean) {
        if (!this.plugin.settings.customSlot) return; 
        this.plugin.settings.customSlot[0].toggle_label_display = value;
        this.plugin.saveSettings();
        this.updateHighlight();
    }
    onToggleGlobalMap(value: boolean) {
        if (!this.plugin.settings.customSlot) return; 
        this.plugin.settings.customSlot[0].toggle_global_map = value;
        this.plugin.saveSettings();
    }
    onText(value: string) {
    }
    applyNodeSize() {
        if (!this.plugin.settings.customSlot) return; 
        const value = this.plugin.settings.customSlot[0].node_size
        let scaleValue = (value / 5 - 1) * 0.6 + 1;
        this.Graph.graphData().nodes.forEach((node: nodeThreeObject) => {
            const obj = node.__threeObj; // 获取节点的 Three.js 对象
            if (obj) {
                obj.scale.set(scaleValue, scaleValue, scaleValue)
            }
        })
    }
    onNodeSize_import(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        this.clearHightlightNodes();
        this.Graph.nodeThreeObject((node: ExtendedNodeObject) => {
            return this.createNodeThreeObject(node)//, value)
        })
        this.plugin.settings.customSlot[0].node_size = value;
        this.plugin.saveSettings();
    }
    onNodeSize(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        let scaleValue = (value / 5 - 1) * 0.6 + 1;
        this.Graph.graphData().nodes.forEach((node: nodeThreeObject) => {
            const obj = node.__threeObj; // 获取节点的 Three.js 对象
            if (obj) {
                obj.scale.set(scaleValue, scaleValue, scaleValue)
            }
        })
        this.plugin.settings.customSlot[0].node_size = value;
        this.plugin.saveSettings();
    }
    onNodeRepulsion(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        this.plugin.settings.customSlot[0].node_repulsion = value;
        this.plugin.saveSettings();
        if (value === 0) return;
        this.Graph.d3Force('charge')?.strength(-30 - value * 300);
        this.Graph
            .d3Force("x", d3.forceX(0).strength(0.19))
            .d3Force("y", d3.forceY(0).strength(0.19))
            .d3Force("z", d3.forceZ(0).strength(0.19))
        this.Graph.d3ReheatSimulation();
        return;
    }

    onLinkButton(linkStar: boolean) {
        this.linkNodeByType(this.orphanToLink as any, linkStar)
    }
    onUnlinkButton() {
        this.unlinkNodeByType(this.orphanToLink as any)
    }
    linkNodeByType(fileType: 'markdown' | 'tag' | 'attachment' | 'broken' | 'pdf' | 'excalidraw' | 'other' | 'frontmatter-tag', linkStar: boolean = true) {
        this.clearHightlightNodes()

        let links: LinkObject[] = this.gData.links;
        let nodes: ExtendedNodeObject[] = this.gData.nodes;
        if (nodes.filter(node => node.id === fileType).length != 0) {
            //    console.log(" has had type node, return.")
            return;
        }
        // 创建一个新的 type 节点
        const typeNode: ExtendedNodeObject = {
            id: fileType,
            type: fileType,
            x: 0,
            y: 0,
            z: 0,
            connections: 0,
            neighbors: [],
            links: []
        };
        if (linkStar) {
            // 找到所有 type 为 filetype 的节点
            const typeNodes = this.gData.nodes.filter(node => node.type === fileType && node.connections == 0);
            if (typeNodes.length == 0) return;
            // 将所有 type 节点连接到新创建的 broken 节点上
            typeNodes.forEach(node => {
                let addLink = { source: typeNode.id, target: node.id, sourceId: typeNode.id, targetId: node.id }
                links.push(addLink);
                !node.neighbors && (node.neighbors = []);
                typeNode.neighbors?.push(node)
                node.neighbors.push(typeNode)
                !node.links && (node.links = [])
                typeNode.links?.push(addLink)
                addLink = { source: node.id, target: typeNode.id, sourceId: node.id, targetId: typeNode.id }
                links.push(addLink)
                node.links?.push(addLink)
                node.orphan = true;

            });
        // 将新创建的 broken 节点添加到节点列表中
        nodes.push(typeNode);
        } else {
            // 将所有 type 节点以一条线连接起来
            const typeNodes = this.gData.nodes.filter(node => node.type === fileType && node.connections == 0)
            if (typeNodes.length == 0) return;
            typeNodes.forEach(node => { node.orphan = true });
            for (let i = 0; i < typeNodes.length - 1; i++) {
                let addLink = { source: typeNodes[i].id, target: typeNodes[i + 1].id, sourceId: typeNodes[i].id, targetId: typeNodes[i + 1].id }
                links.push(addLink);
                typeNodes[i].links?.push(addLink)
                addLink = { target: typeNodes[i].id, source: typeNodes[i + 1].id, targetId: typeNodes[i].id, sourceId: typeNodes[i + 1].id }
                links.push(addLink)
                typeNodes[i + 1].links?.push(addLink)
                !typeNodes[i].neighbors && (typeNodes[i].neighbors = []);
                !typeNodes[i + 1].neighbors && (typeNodes[i + 1].neighbors = []);
                typeNodes[i].neighbors?.push(typeNodes[i + 1])
                typeNodes[i + 1].neighbors?.push(typeNodes[i])


            }
        }
        //统计connections数量 
        // 计算每个节点的连接数
        nodes.forEach((node: ExtendedNodeObject) => {
            node.connections = links.filter(link => link.sourceId === node.id || link.targetId === node.id).length;
        });
        //    this.gData = { nodes: nodes, links: links };
        // 重新计算连接数
        //this.calculateConnections();
        // 更新图表数据
        this.Graph.graphData(this.gData);
        this.Graph.refresh();
    }
    unlinkNodeByType(fileType: string) {
        this.clearHightlightNodes()
        // 移除所有连接到 type 节点的链接
        let links: LinkObject[] = [];
        let nodes: ExtendedNodeObject[] = [];
        if (0) {
            links = this.gData.links.filter(link => link.sourceId !== fileType && link.targetId !== fileType);
        } else {
            links = this.gData.links.filter((link: LinkObject) => {
                const linkSource = link.source as ExtendedNodeObject
                const linkTarget = link.target as ExtendedNodeObject
                if (!(
                    (linkSource.type == fileType || linkTarget.type == fileType) &&
                    (linkSource.orphan == true || linkTarget.orphan == true))) {
                    return true;
                }

            })
        }
        if (links.length == 0) return;
        // 移除 type 节点
        nodes = this.gData.nodes.filter(node => node.id !== fileType);
        //统计connections数量 
        // 计算每个节点的连接数
        nodes.forEach((node: ExtendedNodeObject) => {
            node.connections = links.filter(link => link.sourceId === node.id || link.targetId === node.id).length;
        });
        // 重新计算连接数
        // 更新图表数据
        this.gData = { nodes: nodes, links: links }
        this.Graph.graphData(this.gData);
        this.Graph.refresh();
    }
/*

    connectExcalidrawNodes() {
        // 提取所有未连接的 excalidraw 类型节点
        const unconnectedExcalidrawNodes = this.gData.nodes.filter(
            (node: ExtendedNodeObject) => node.type === 'excalidraw' && !this.gData.links.some(link => link.sourceId === node.id || link.targetId === node.id)
        );
        if (unconnectedExcalidrawNodes.length === 0) return;
        // 创建一个新的 excalidraw 节点
        const newExcalidrawNode: ExtendedNodeObject = {
            id: 'excalidraw',
            type: 'excalidraw',
            x: 0,
            y: 0,
            z: 0,
            connections: 0
        };
        // 将新节点添加到节点列表中
        this.gData.nodes.push(newExcalidrawNode);
        // 将未连接的 excalidraw 节点连接到新节点
        unconnectedExcalidrawNodes.forEach((node: ExtendedNodeObject) => {
            this.gData.links.push({ source: newExcalidrawNode.id, target: node.id, sourceId: newExcalidrawNode.id, targetId: node.id });
            newExcalidrawNode.connections! += 1;
            node.connections = (node.connections || 0) + 1;
        });
        // 重新渲染 Graph
        this.Graph.graphData(this.gData);
    }*/
    onResetGraph() {
        this.clearHightlightNodes();
        this.gData = this.buildGdata();
        this.Graph.graphData(this.gData);
        this.Graph.refresh();
    }
    /*
    // 恢复 UnlinkedExcalidrawNodes 节点的方法
    resetUnlinkedExcalidrawNodes() {
        // 移除所有连接到 broken 节点的链接
        this.gData.links = this.gData.links.filter(link => link.sourceId !== 'excalidraw' && link.targetId !== 'excalidraw');
        // 移除 broken 节点
        this.gData.nodes = this.gData.nodes.filter(node => node.id !== 'excalidraw');
        // 重新计算连接数
        this.calculateConnections();
        // 更新图表数据
        this.Graph.graphData(this.gData);
    }*/
    deepEqual(obj1: any, obj2: any): boolean {
        if (obj1 === obj2) return true;
        if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
            return false;
        }
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length) return false;
        for (const key of keys1) {
            if (!keys2.includes(key) || !this.deepEqual(obj1[key], obj2[key])) {
                return false;
            }
        }
        return true;
    }
    onSlotSliderChange(value: number) {
        if (!this.plugin.settings.customSlot) return; 
        if (this.currentSlotNum == value) return;
        //  console.log("saveing slot: ", value, " : ", this ?.plugin ?.settingsSlots[value]);
        this.currentSlotNum = value;
        //console.log("Tags routes: set current slot: ", this.currentSlotNum)
        //   console.log(" slot 0", this.plugin.settings.customSlot[0]);
        //   console.log(" slot ", this.plugin.settings.currentSlot, ":", this.plugin.settings.customSlot[this.plugin.settings.currentSlot])
        if (!this.deepEqual(this.plugin.settings.customSlot[0], this.plugin.settings.customSlot[this.plugin.settings.currentSlotNum])) {
            // not load, just return
            console.log(`Tags routes: Settings changed, click 'Save' to save to slot ${this.currentSlotNum}`)
           // console.log("slot 0", this.plugin.settings.customSlot[0])
           // console.log("slot ", this.currentSlotNum, this.plugin.settings.customSlot[this.plugin.settings.currentSlotNum])
            new Notice(`Tags routes: Settings changed, click 'Save' to save to slot ${this.currentSlotNum}`, 5000);
            this.setSaveButton(true)
            return;
        } else {
          //  console.log("it is the same, go to load effects")
        }
        console.log("Load from slot: ", this.currentSlotNum)
        this.plugin.settings.customSlot[0] = structuredClone(this.plugin.settings.customSlot[this.currentSlotNum]);
        this.plugin.settings.currentSlotNum = this.currentSlotNum;
        this.plugin.settings.themeSlotNum[this.plugin.settings.currentTheme] = this.currentSlotNum;
        this.plugin.saveSettings();
        //   console.log("_control num: ", this._controls.length);
        //   console.log("_controls: ", this._controls);
        // 使用辅助函数
        this.plugin.skipSave = true;
        this.applyChanges();
        this.updateColor();
        this.plugin.skipSave = false;
        new Notice(`Tags routes: Load slot ${this.currentSlotNum}`);
    }
    onSettingsSave() {
        if (!this.plugin.settings.customSlot) return; 
        this.plugin.settings.customSlot[this.currentSlotNum] = structuredClone(this.plugin.settings.customSlot[0]);
        this.plugin.settings.currentSlotNum = this.currentSlotNum;
        this.plugin.settings.themeSlotNum[this.plugin.settings.currentTheme] = this.currentSlotNum;
        this.plugin.saveSettings();
        console.log("[onSettingsSave] Save to slot: ", this.currentSlotNum)
        new Notice(`Tags routes: Graph save to slot ${this.currentSlotNum}`);
        this.setSaveButton(false)
    }
    setControlValue<K extends keyof TagRoutesSettings>(
        controlId: string,
        controlArray: { id: string; control: ValueComponent<any> }[],
        settings: TagRoutesSettings,
        settingKey: K
    ): void {
        const controlEntry = controlArray.find(v => v.id === controlId);
        if (controlEntry) {
            controlEntry.control.setValue(settings[settingKey]);
        }
    }
    applyChanges() {
        if (!this.plugin.settings.customSlot) return; 
        this.setControlValue("Node size", this._controls,
            this.plugin.settings.customSlot[this.currentSlotNum], "node_size");
        this.setControlValue("Node repulsion", this._controls,
            this.plugin.settings.customSlot[this.currentSlotNum], "node_repulsion");
        this.setControlValue("Link distance", this._controls,
            this.plugin.settings.customSlot[this.currentSlotNum], "link_distance");
        this.setControlValue("Link width", this._controls,
            this.plugin.settings.customSlot[this.currentSlotNum], "link_width");
        this.setControlValue("Link particle size", this._controls,
            this.plugin.settings.customSlot[this.currentSlotNum], "link_particle_size");
            this.setControlValue("Link particle number", this._controls,
        this.plugin.settings.customSlot[this.currentSlotNum], "link_particle_number");
    }
    onSettingsLoad() {
        if (!this.plugin.settings.customSlot) return; 
        console.log("Load from slot: ", this.currentSlotNum)
        this.plugin.settings.customSlot[0] = structuredClone(this.plugin.settings.customSlot[this.currentSlotNum]);
        this.plugin.settings.currentSlotNum = this.currentSlotNum;
        this.plugin.saveSettings();
        
        this.plugin.skipSave = true;
        // 使用辅助函数
        this.applyChanges();
        this.updateColor();
        this.plugin.skipSave = false;
        //new Notice('Graph load on slot ', this.currentSlot);
        new Notice(`Tags routes: Graph load from slot ${this.currentSlotNum}`);
    }
    onSettingsReset() {
        if (!this.plugin.settings.customSlot) return; 
        this.plugin.settings.customSlot[0] = structuredClone(DEFAULT_DISPLAY_SETTINGS[this.plugin.settings.currentTheme]);
        this.plugin.settings.customSlot[this.currentSlotNum] = structuredClone(DEFAULT_DISPLAY_SETTINGS[this.plugin.settings.currentTheme]);
        this.plugin.saveSettings();
        this.applyChanges();
        this.updateColor();
        new Notice(`Graph reset on slot ${this.currentSlotNum}`);
    }
    onDropdown(value: string) {
        this.orphanToLink = value;
        console.log(value, "selected")
    }/*
    // 连接所有 broken 节点的方法
    connectBrokenNodes(linkStar: boolean) {
        this.clearHightlightNodes()

        let links: LinkObject[] = this.gData.links;
        let nodes: ExtendedNodeObject[] = this.gData.nodes;
        if (nodes.filter(node => node.id === 'broken').length != 0) {
            //    console.log(" has had broken node, return.")
            return;
        }
        // 创建一个新的 broken 节点
        const brokenNode: ExtendedNodeObject = {
            id: 'broken',
            type: 'broken',
            x: 0,
            y: 0,
            z: 0,
            connections: 0,
            neighbors: [],
            links: []
        };
        if (linkStar) {
            // 找到所有 type 为 broken 的节点
            const brokenNodes = this.gData.nodes.filter(node => node.type === 'broken');
            //      console.log("broken nodes number: ", brokenNodes.length)
            // 将所有 broken 节点连接到新创建的 broken 节点上
            //     !brokenNode.neighbors && (brokenNode.neighbors = []);
            //     !brokenNode.links && (brokenNode.links = [])
            brokenNodes.forEach(node => {
                let addLink = { source: brokenNode.id, target: node.id, sourceId: brokenNode.id, targetId: node.id }
                links.push(addLink);
                !node.neighbors && (node.neighbors = []);
                brokenNode.neighbors?.push(node)
                node.neighbors.push(brokenNode)
                !node.links && (node.links = [])
                brokenNode.links?.push(addLink)
                addLink = { source: node.id, target: brokenNode.id, sourceId: node.id, targetId: brokenNode.id }
                links.push(addLink)
                node.links?.push(addLink)

            });
        } else {
            // 将所有 broken 节点以一条线连接起来
            const brokenNodes = this.gData.nodes.filter(node => node.type === 'broken');
            //    console.log("broken nodes number: ", brokenNodes.length)
            for (let i = 0; i < brokenNodes.length - 1; i++) {
                let addLink = { source: brokenNodes[i].id, target: brokenNodes[i + 1].id, sourceId: brokenNodes[i].id, targetId: brokenNodes[i + 1].id }
                links.push(addLink);
                brokenNodes[i].links?.push(addLink)
                addLink = { target: brokenNodes[i].id, source: brokenNodes[i + 1].id, targetId: brokenNodes[i].id, sourceId: brokenNodes[i + 1].id }
                links.push(addLink)
                brokenNodes[i + 1].links?.push(addLink)
                !brokenNodes[i].neighbors && (brokenNodes[i].neighbors = []);
                !brokenNodes[i + 1].neighbors && (brokenNodes[i + 1].neighbors = []);
                brokenNodes[i].neighbors?.push(brokenNodes[i + 1])
                brokenNodes[i + 1].neighbors?.push(brokenNodes[i])

            }
        }
        // 将新创建的 broken 节点添加到节点列表中
        nodes.push(brokenNode);
        //统计connections数量 
        // 计算每个节点的连接数
        nodes.forEach((node: ExtendedNodeObject) => {
            node.connections = links.filter(link => link.sourceId === node.id || link.targetId === node.id).length;
        });
        //    this.gData = { nodes: nodes, links: links };
        // 重新计算连接数
        //this.calculateConnections();
        // 更新图表数据
        this.Graph.graphData(this.gData);
        this.Graph.refresh();
    }*/
    clearHightlightNodes() {
        this.selectedNode = null
        this.selectedNodes.clear();
        this.selectedNodesLinks.clear();
        this.hoverNode = null
        this.hoveredNodes.clear();
        this.hoveredNodesLinks.clear();
        this.highlightLinks.clear();
        this.highlightNodes.clear();
    }
    /*
    // 恢复 broken 节点的方法
    resetBrokenNodes() {
        this.clearHightlightNodes()
        // 移除所有连接到 broken 节点的链接
        let links: LinkObject[] = [];
        let nodes: ExtendedNodeObject[] = [];
        if (0) {
            this.gData.links = this.gData.links.filter(link => link.sourceId !== 'broken' && link.targetId !== 'broken');
        } else {
            links = this.gData.links.filter((link: LinkObject) => (link.source as ExtendedNodeObject).type !== 'broken');
        }
        // 移除 broken 节点
        nodes = this.gData.nodes.filter(node => node.id !== 'broken');
        //统计connections数量 
        // 计算每个节点的连接数
        nodes.forEach((node: ExtendedNodeObject) => {
            node.connections = links.filter(link => link.sourceId === node.id || link.targetId === node.id).length;
        });
        // 重新计算连接数
        // 更新图表数据
        this.gData = { nodes: nodes, links: links }
        this.Graph.graphData(this.gData);
        this.Graph.refresh();

    }*/
    // 计算连接数的方法
    calculateConnections() {
        const nodes: ExtendedNodeObject[] = this.gData.nodes;
        nodes.forEach((node: ExtendedNodeObject) => {
            node.connections = this.gData.links.filter(link => link.sourceId === node.id || link.targetId === node.id).length;
        });
        this.gData.nodes = nodes;
    }
    getCache() {
        this.app.vault.getFiles()
            .forEach(file => {
                const cache = this.app.metadataCache.getCache(file.path);
                filesDataMap.set(file.path, cache);
            });
    }
    getNodeColorByType(node: Node) {
        if (!this.plugin.settings.customSlot) return "#ffffff"; 
        let color;
        switch (node.type) {
            case 'markdown':
            case 'tag':
            case 'attachment':
            case 'broken':
            case 'excalidraw':
                color = this.plugin.settings.customSlot[0].colorMap[node.type].value;
                break;
            case 'frontmatter-tag':
                color = 'DarkSalmon';
                break;
            default:
                color = '#ffffff'; // 默认颜色
        }
        if (this.plugin.settings.customSlot[0].toggle_global_map) {
            if (this.highlightNodes.has(node)) color = this.plugin.settings.customSlot[0].colorMap["nodeHighlightColor"].value;
            if (node === this.selectedNode || node === this.hoverNode)
                color = this.plugin.settings.customSlot[0].colorMap["nodeFocusColor"].value;
        }
        return color;
    }
    buildGdata(): GraphData {
        const nodes: ExtendedNodeObject[] = [];
        const links: LinkObject[] = [];
        const tagSet: Set<string> = new Set();
        const tagLinks: Set<string> = new Set();
        const frontmatterTagLinks: Set<string> = new Set();
        const frontmatterTagSet: Set<string> = new Set();
        let fileNodeNum = 0;
        let FileLinkNum = 0;
        let TagNodeNum = 0;
        let TagLinkNum = 0;

        /*
          Add nodes which are linked together
        */
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        const tagCount: Map<string, number> = new Map(); // 初始化标签计数对象
        const frontmatterTagCount: Map<string, number> = new Map(); // 初始化标签计数对象
        // 添加resolved links来创建文件间的关系，和文件节点
        for (const sourcePath in resolvedLinks) {
            if (!nodes.some(node => node.id == sourcePath)) {
                nodes.push({ id: sourcePath, type: getFileType(sourcePath) });
            }
            const targetPaths = resolvedLinks[sourcePath];
            for (const targetPath in targetPaths) {
                // 确保目标文件也在图中
                if (!nodes.some(node => node.id == targetPath)) {
                    nodes.push({ id: targetPath, type: getFileType(targetPath) });
                }
                // 创建链接
                links.push({ source: sourcePath, target: targetPath, sourceId: sourcePath, targetId: targetPath });
            }
        }
        fileNodeNum = nodes.length;
        FileLinkNum = links.length;
        this.debugLogToFileM("", true)
        this.debugLogToFileM(`|File parse completed=>|| markdown and linked files nodes:| ${nodes.length}| total file links:| ${links.length}|`)

        /*
          Add tags
        */
        filesDataMap.forEach((cache, filePath) => {
            if (cache?.frontmatter && cache?.frontmatter?.tags && cache.frontmatter.tags.contains("tag-report"))
                return;
            // 确保目标文件也在图中
            if (!nodes.some(node => node.id == filePath)) {
                let fileType = getFileType(filePath)
                /* 
                    Unresolved attachment is a broken file 
                */
                if (fileType == 'attachment') fileType = 'broken'
                nodes.push({ id: filePath, type: fileType });


             //   nodes.push({ id: filePath, type: 'broken' });
            }

            /*
            Add tags in note content
            */
            const fileTags = getTags(cache).map(cache => cache.tag);
            const rootTags = new Set<string>();

            fileTags.forEach(fileTag => {
                const tagParts = fileTag.split('/');
                let currentTag = '';

                tagParts.forEach((part, index) => {
                    currentTag += (index > 0 ? '/' : '') + part;

                    // 更新根标签
                    if (index === 0) {
                        rootTags.add(currentTag);
                    }

                    // 更新标签计数
                    tagCount.set(currentTag, (tagCount.get(currentTag) || 0) + 1);

                    // 创建节点
                    if (!tagSet.has(currentTag)) {
                        nodes.push({ id: currentTag, type: 'tag' });
                        tagSet.add(currentTag);
                    }

                    // 创建链接
                    if (index > 0) {
                        const parentTag = tagParts.slice(0, index).join('/');
                        const linkKey = `${parentTag}->${currentTag}`;
                        if (!tagLinks.has(linkKey)) {
                            links.push({ source: parentTag, target: currentTag, sourceId: parentTag, targetId: currentTag });
                            tagLinks.add(linkKey);
                        }
                    }
                });
            });

            rootTags.forEach(rootTag => {
                links.push({ source: filePath, target: rootTag, sourceId: filePath, targetId: rootTag });
            });
            /*
            Add tags in note frontmatter
            */
            const frontmatterTags: string[] = []
            const frontmatterRootTags = new Set<string>();
            
            //get frontmatter tags

            // according to bug issue: https://github.com/kctekn/obsidian-TagsRoutes/issues/10
            if (cache?.frontmatter?.tags != undefined) {
                let tags = cache.frontmatter.tags;

                if (typeof tags === "string") {
                    tags = [tags];
                }

                if (Array.isArray(tags)) {
                    tags.forEach((element: string) => {
                        if (element !== "excalidraw") {
                            frontmatterTags.push(element);
                        }
                    });
                } else {
                    console.error('Unexpected tags format:', tags);
                }
            }


            frontmatterTags.forEach(fileTag => {

                const tagParts = fileTag.split('/');
                let currentTag = '';

                tagParts.forEach((part, index) => {
                    currentTag += (index > 0 ? '/' : '') + part;

                    // 更新根标签
                    if (index === 0) {
                        frontmatterRootTags.add(currentTag);
                    }

                    // 更新标签计数
                    frontmatterTagCount.set(currentTag, (frontmatterTagCount.get(currentTag) || 0) + 1);

                    // 创建节点
                    if (!frontmatterTagSet.has(currentTag)) {
                        nodes.push({ id: currentTag, type: 'frontmatter-tag' });
                        frontmatterTagSet.add(currentTag);
                    }

                    // 创建链接
                    if (index > 0) {
                        const parentTag = tagParts.slice(0, index).join('/');
                        const linkKey = `${parentTag}->${currentTag}`;
                        if (!tagLinks.has(linkKey)) {
                            links.push({ source: parentTag, target: currentTag, sourceId: parentTag, targetId: currentTag });
                            tagLinks.add(linkKey);
                        }
                    }
                });
            });

            frontmatterRootTags.forEach(rootTag => {
                links.push({ source: filePath, target: rootTag, sourceId: filePath, targetId: rootTag });
            });


        });
        //markdwon + orphan + tags
        const brokennum = nodes.filter(node => node.type == 'broken').length;
        this.debugLogToFileM(`|add tags and other files=>||  total nodes: |${nodes.length}|  total links:| ${links.length}|`)
        TagNodeNum = nodes.length - fileNodeNum - brokennum;
        TagLinkNum = links.length - FileLinkNum;
        // 过滤节点和链接
        // 直接移除满足条件的节点
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (shouldRemove(nodes[i].id, filterStrings)) {
                nodes.splice(i, 1);
            }
        }
        // 直接移除满足条件的链接
        for (let i = links.length - 1; i >= 0; i--) {
            if (shouldRemove(links[i].sourceId, filterStrings) || shouldRemove(links[i].targetId, filterStrings)) {
                links.splice(i, 1);
            }
        }
        this.debugLogToFileM(`|After filtered pathes=>|| filtered nodes: |${TagNodeNum + fileNodeNum + brokennum - nodes.length}|  links:| ${links.length}|`)
        // 计算每个节点的连接数
        nodes.forEach((node: ExtendedNodeObject) => {
            node.connections = links.filter(link => link.sourceId === node.id || link.targetId === node.id).length;
            node.size = node.connections;
        });
        // 设置tag类型节点的instanceNum值并根据该值调整大小
        nodes.forEach((node: ExtendedNodeObject) => {
            if (node.type === 'tag') {
                node.instanceNum = tagCount.get(node.id) || 1;
                // 根据instanceNum调整节点大小，可以按比例调整
                //        node.size = Math.log2(node.instanceNum + 1) * 5; // 例如，使用对数比例调整大小
                node.size = node.instanceNum;
            }
        });
        // cross-link node objects
        links.forEach(link => {
            const a = nodes.find(node => node.id === link.sourceId) as ExtendedNodeObject;
            const b = nodes.find(node => node.id === link.targetId) as ExtendedNodeObject;
            !a.neighbors && (a.neighbors = []);
            !b.neighbors && (b.neighbors = []);
            a.neighbors.push(b);
            b.neighbors.push(a);
            !a.links && (a.links = []);
            !b.links && (b.links = []);
            a.links.push(link);
            b.links.push(link);
        });
        this.debugLogToFileM(`|Tags parse completed=>||  tag nodes: |${TagNodeNum}| tag links:| ${TagLinkNum}|`)
        this.debugLogToFileM("|tags num:| " + (TagNodeNum) + "| broken files: |" + brokennum + "| tag links:| " + TagLinkNum + "|")
        this.debugWriteToFile();
        if (this.plugin.settings.enableShow) {
            showFile(logFilePath);
        }
        return { nodes: nodes, links: links };
    }
    getOrphanNodes(nodes: ExtendedNodeObject[]): Record<string, string> {
        const orphanNodes: Record<string, string> = {};
    
        nodes.forEach((node) => {
            if (node.connections === 0) {
                const extension = node.type; // Assuming 'type' represents the extension here
                orphanNodes[extension] = extension; // Assuming 'id' is a unique identifier for each node
            }
        });
    
        return orphanNodes;
    }
    distanceFactor: number = 2;
    createGraph(container: HTMLElement) {
        
        // 打印结果
        container.addClass("tags-routes")
        const graphContainer = container.createEl('div', { cls: 'graph-container' });

        // Tooltips for new users
        const tooltipBar = container.createEl('div', { cls: 'tooltip-wrapper'});

        // do not delete: need this to style the tooltips INSIDE the bar.
        const tooltips = tooltipBar.createEl('div', { cls: 'tooltip-flexbox-container'});

        //simple platform-specific controls. Hello MacOS users!
        const platform = Platform.isMobile ? '0' : Platform.isMacOS ? '1' : '2';  
        const controls = [
            /* cameraPan */ ['Drag', 'Click and Drag', 'Hold LMB + Drag', 'Pan:'],
            /* cameraMove */ ['Drag with Two Fingers', 'Click and Drag with Two Fingers', 'Hold RMB + Drag', 'Move:'],
            /* cameraZoom */ ['Swipe with Two Fingers', 'Swipe Up/Down with Two Fingers', 'Scroll Up/Down', 'Zoom:']
        ]
        controls.forEach(control => {
            tooltips.createEl('p', { cls: 'tooltip-flexbox', text: `${control[3]} ${control[platform]}`});
            tooltips.createEl('div', { cls: 'tooltip-divider'});
        });

        const hideToolbar = tooltipBar.createEl('button', { text: '<', cls: 'tooltip-flexbox-container-hide'})
        hideToolbar.addEventListener('click', () => {
            tooltipBar.classList.toggle('hidden');
            hideToolbar.innerHTML = tooltipBar.hasClass('hidden') ? '>' : '<';
        })

        this.Graph = ForceGraph3D()
            //  .width(container.clientWidth)
            //  .height(container.clientHeight)
            .backgroundColor("#000003")
            .d3Force('link', d3.forceLink().distance((link: any) => {
                const distance = Math.max(link.source.connections, link.target.connections, link.source.instanceNum || 2, link.target.instanceNum || 2);
                return distance < 10 ? 20 : distance * this.distanceFactor;
            }))
            (graphContainer)
            .nodeVisibility(this.getNodeVisible)
            .linkVisibility(this.getLinkVisible)
            .linkColor((link: any) => this.highlightLinks.has(link) ? this.plugin.settings.customSlot?.[0].colorMap["linkHighlightColor"].value||"#ffffff" :
                this.plugin.settings.customSlot?.[0].colorMap["linkNormalColor"].value||"#ffffff")
            .linkWidth((link: any) => this.highlightLinks.has(link) ? 2 : 1)
            .linkDirectionalParticles((link: any) => this.highlightLinks.has(link) ? 4 : 2)
            .linkDirectionalParticleWidth((link: any) => this.highlightLinks.has(link) ? 3 : 0.5)
            .linkDirectionalParticleColor((link: any) => this.highlightLinks.has(link) ? this.plugin.settings.customSlot?.[0].colorMap["linkParticleHighlightColor"].value || "#ffffff":
                this.plugin.settings.customSlot?.[0].colorMap["linkParticleColor"].value||"#ffffff")
            //   .nodeLabel((node: any) => node.type == 'tag' ? `${node.id} (${node.instanceNum})` : `${node.id} (${node.connections})`)
            .nodeOpacity(0.9)
            .nodeThreeObject(this.createNodeThreeObject)
            .onNodeClick((node: ExtendedNodeObject) => {
                const distance = this.getCameraDistance(node);
                const distRatio = 1 + distance / Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0);
                const newPos = node.x || node.y || node.z
                    ? { x: (node.x ?? 0) * distRatio, y: (node.y ?? 0) * distRatio, z: (node.z ?? 0) * distRatio }
                    : { x: 0, y: 0, z: distance }; // special case if node is in (0,0,0)
                this.Graph.cameraPosition(
                    newPos, // new position
                    { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
                    3000  // ms transition duration
                );
                this.handleNodeClick(node);
                this.highlightOnNodeClick(node);
            })
            .onNodeRightClick((node: ExtendedNodeObject) => {
                this.highlightOnNodeRightClick(node);
            })
            .onBackgroundClick(() => {
                this.highlightOnNodeClick(null);
            })
            .onNodeDragEnd((node: any) => {
                node.fx = node.x;
                node.fy = node.y;
                node.fz = node.z;
            })
            .onNodeHover((node: ExtendedNodeObject) => this.highlightOnNodeHover(node))
            .onLinkHover((link: any) => this.onLinkHover(link))
            .cooldownTicks(10000)
        //Graph.onEngineStop(()=>Graph.zoomToFit(4000))  //自动复位
/*         const bloomPass = new (UnrealBloomPass)(({ x: container.clientWidth, y: container.clientHeight } as Vector2), 2.0, 1, 0)
        this.Graph.postProcessingComposer().addPass(bloomPass); */
        // 使用 MutationObserver 监听容器大小变化
        const observer = new MutationObserver(() => {
            const newWidth = container.clientWidth
            const newHeight = container.clientHeight;
            this.Graph.width(newWidth).height(newHeight);
        });
        observer.observe(container, { attributes: true, childList: true, subtree: true });
        // 清理 observer
        this.register(() => observer.disconnect());
        //this.plugin.settings.customSlot = this.plugin.settings[this.plugin.settings.currentTheme];
        if (!this.plugin.settings.customSlot) return;  //make sure it has value and avoid typescript error report
        this.plugin.skipSave = true;
        new settingGroup(this.plugin, "Tags' route settings", "Tags' route settings", "root").hide()
            .add({
                arg: (new settingGroup(this.plugin, "commands", "Node commands"))
                .addDropdown("Select orphan", this.getOrphanNodes(this.gData.nodes)/* { broken: "broken", pdf: "pdf", excalidraw: "excalidraw" }*/, "broken", this.onDropdown)
                .add({
                    arg: (new settingGroup(this.plugin, "link-box", "link-box", "flex-box")
                        /*                             .addButton("Star", "graph-button", () => { this.onLinkButton() })
                                                    .addButton("Line", "graph-button", () => { this.onLinkButton() })
                                                    .addButton("Unlink", "graph-button", () => { this.onUnlinkButton() }) */
                        .addExButton("circle-dashed", "Link orphan type as a star", () => this.onLinkButton(true))
                        .addExButton("spline", "Link orphan type as a line", () => this.onLinkButton(false))
                        .addExButton("unlink-2", "Unlink orphans", this.onUnlinkButton)
                        .addExButton("corner-up-left", "Reset graph", this.onResetGraph)
                    )
                })
                  /*  .addButton("Link broken as star", "graph-button", () => { this.connectBrokenNodes(true) })
                    .addButton("Link broken as line", "graph-button", () => { this.connectBrokenNodes(false) })
                    .addButton("Unlink broken", "graph-button", () => { this.resetBrokenNodes() })
                    .addButton("Link Excalidraw orphans", "graph-button", () => { this.connectExcalidrawNodes() })
                    .addButton("Unlink Excalidraw orphans", "graph-button", () => { this.resetUnlinkedExcalidrawNodes() })
                    .addButton("Reset graph", "graph-button", () => { this.onResetGraph() })*/
            })
            .add({
                arg: (new settingGroup(this.plugin, "control sliders", "Display control"))
                    .addSlider("Node size", 1, 10, 1, this.plugin.settings.customSlot[0].node_size, this.onNodeSize)
                    .addSlider("Node repulsion", 0, 10, 1, this.plugin.settings.customSlot[0].node_repulsion, this.onNodeRepulsion)
                    .addSlider("Link distance", 1, 25, 1, this.plugin.settings.customSlot[0].link_distance, this.onLinkDistance)
                    .addSlider("Link width", 1, 5, 1, this.plugin.settings.customSlot[0].link_width, this.onLinkWidth)
                    .addSlider("Link particle size", 1, 5, 1, this.plugin.settings.customSlot[0].link_particle_size, this.onLinkParticleSize)
                    .addSlider("Link particle number", 1, 5, 1, this.plugin.settings.customSlot[0].link_particle_number, this.onLinkParticleNumber)
                    .addToggle("Toggle global map", this.plugin.settings.customSlot[0].toggle_global_map, this.onToggleGlobalMap)
                    .addToggle("Toggle label display", this.plugin.settings.customSlot[0].toggle_label_display, this.onToggleLabelDisplay)
            })
            .add({
                arg: (new settingGroup(this.plugin, "save-load", "Save and load"))
                    .addSlider("Slot #", 1, 5, 1, this.plugin.settings.currentSlotNum, this.onSlotSliderChange)
                    .add({
                        arg: (new settingGroup(this.plugin, "button-box", "button-box", "flex-box")
                            .addButton("Apply theme color", "graph-button", () => { this.applyThemeColor() })
                        )
                    })
                    .add({
                        arg: (new settingGroup(this.plugin, "button-box", "button-box", "flex-box")
                            .addButton("Save", "graph-button", () => { this.onSettingsSave() }).getLastElement(this.saveButtonRef)
                            .addButton("Load", "graph-button", () => { this.onSettingsLoad() })
                            .addButton("Reset", "graph-button", () => { this.onSettingsReset() })
                        )
                    })
            })
            //   .add({
            //       arg: (new settingGroup("file filter", "File filter"))
            //           .addText("Filter path1", this.onText)
            //   })
//            .attachEl(graphContainer.createEl('div', { cls: 'settings-container' }))
            .attachEl(graphContainer.createEl('div', { cls: 'graph-controls' }))
            .hideAll();
        this.plugin.skipSave = false;
    }
    // 点击节点后的处理函数
    handleTagClick(node: ExtendedNodeObject) {
        if (node.type === 'tag') {
            const sanitizedId = node.id.replace(/\//g, '__');
            const newFilePath = `TagsRoutes/reports/TagReport_${sanitizedId}.md`; // 新文件的路径和名称
            const fileContent1 = `---\ntags:\n  - tag-report\n---\n
\`\`\`tagsroutes
    ${node.id}
\`\`\`
`; // 要写入的新内容
            this.createAndWriteToFile(newFilePath, fileContent1);
        }
        if (node.type === 'frontmatter-tag') {
            console.log("handleTagClick::frontmatter tag:", node.id)
            const sanitizedId = node.id.replace(/\//g, '__');
            const newFilePath = `TagsRoutes/reports/TagReport_frontmatter-tag_${sanitizedId}.md`; // 新文件的路径和名称
            const fileContent1 = `---\ntags:\n  - tag-report\n---\n
\`\`\`tagsroutes
    frontmatter-tag: ${node.id}
\`\`\`
`; // 要写入的新内容
            this.createAndWriteToFile(newFilePath, fileContent1);
        }
    }
    // 创建文件并写入内容的函数
    async createAndWriteToFile(filePath: string, content: string) {
        const { vault } = this.app;
        // 检查文件是否已经存在
        if (!vault.getAbstractFileByPath(filePath)) {
            await vault.create(filePath, content);
            //    console.log("create query file.")
        } else {
            // 如果文件已经存在，可以选择覆盖内容或者追加内容
            const file = vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await vault.modify(file, content); // 这里是覆盖内容
            }
        }
        // 打开新创建的文件
        const file = vault.getAbstractFileByPath(filePath)
        if (file && file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(file)
            setViewType(leaf.view, "preview")
        }
    }
    createdFile = false;
    logMessages: string[] = [];
    debugLogToFileM(content: string, head: boolean = false) {
        if (!head) {
            this.logMessages.push("|[" + moment(new Date()).format('YYYY-MM-DD HH:mm:ss') + "] " + content + "\n");
        } else {
            this.logMessages.push("\n\n||||||||\n|-:|-:|-:|-:|-:|-:|-:|\n");
        }
    }
    async debugWriteToFile() {
        if (!this.plugin.settings.enableSave) return;
        const { vault } = this.app;
        const content = this.logMessages;
        // 检查文件是否已经存在
        if (!vault.getAbstractFileByPath(logFilePath)) {
            if (!this.createdFile) {
                this.createdFile = true;
                await vault.create(logFilePath, content.join(""));
                // console.log("create log file.")
            }
        } else {
            // 如果文件已经存在，可以选择覆盖内容或者追加内容
            const file = vault.getAbstractFileByPath(logFilePath);
            //        console.log("using existing log file")
            if (file instanceof TFile) {
                //    vault.append(file, content.join(""))
                await vault.process(file, (data) => {
                    return data + '\n' + content.join("");
                });
            } else {
                //    console.log("file is not ready, passed out")
            }
        }
        this.logMessages.length = 0;
    }
    /** 
     *   Process node operation
     * 
    */
    async handleNodeClick(node: ExtendedNodeObject) {
        const filePath = node.id;
        const { workspace, vault } = this.app
        if (node.type !== 'tag' && node.type !== 'frontmatter-tag') {
            const file = vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) {
                return;
            }
            const leaves = this.app.workspace.getLeavesOfType("markdown");
            const existingLeaf = leaves.find(leaf => (leaf.view as MarkdownView).file?.path === filePath);

            if (existingLeaf) {

                this.app.workspace.setActiveLeaf(existingLeaf);
            } else {
                const leaf = workspace.getLeaf(false);
                await leaf.openFile(file);
                setViewType(leaf.view, "preview");
            }
            // 切换到阅读模式
            const view = this.app.workspace.getActiveViewOfType(MarkdownView) as MarkdownView;
            setViewType(view, "preview");
        } else {
            this.handleTagClick(node);
        }
    }
    // view的open 事件
    async onOpen() {
        //    console.log("On open tag routes view")
        this.container.empty();
        this.getCache();
        this.gData = this.buildGdata();
        this.createGraph(this.container as HTMLElement);
        setTimeout(() => {
            this.plugin.view.switchTheme(this.plugin.settings.currentTheme);
          }, 0);
        this.Graph.graphData(this.gData);
        //need a delay for scene creation
        setTimeout(() => {
            if (!this.plugin.settings.customSlot) return;
            this.setControlValue("Node size", this._controls,
                this.plugin.settings.customSlot[this.currentSlotNum], "node_size");
        }, 2000);

    }
    // view 的close 事件
    async onClose() {
        // Nothing to clean up.
    }
}
