/**
 * IPC 通道常量。渲染进程统一通过 window.seer.invoke(channel, payload) 调用，
 * 主进程通过 evt:* 通道向渲染进程推送事件。
 */
export const IPC = {
  // 标签页 / 导航
  TabCreate: 'tab:create',
  TabList: 'tab:list',
  TabActivate: 'tab:activate',
  TabClose: 'tab:close',
  TabNavigate: 'tab:navigate',
  TabBack: 'tab:back',
  TabForward: 'tab:forward',
  TabReload: 'tab:reload',
  TabStop: 'tab:stop',

  // Canvas 探测
  ProbeCanvas: 'probe:canvas',
  ProbeSelect: 'probe:select',
  ProbeCurrent: 'probe:current',

  // 截图 / 推理
  CaptureFrame: 'capture:frame',
  DetectOnce: 'detect:once',
  DetectStart: 'detect:start',
  DetectStop: 'detect:stop',
  OverlayClear: 'overlay:clear',

  // 模型管理
  ModelList: 'model:list',
  ModelImport: 'model:import',
  ModelSelect: 'model:select',
  ModelRemove: 'model:remove',
  ModelUpdate: 'model:update',
  ModelGenerateDummy: 'model:generate-dummy',
  ModelFetchOfficial: 'model:fetch-official',

  // 缓存
  CacheListPages: 'cache:list-pages',
  CacheCurrent: 'cache:current',
  CacheSaveModule: 'cache:save-module',
  CacheUpdateModule: 'cache:update-module',
  CacheDeleteModule: 'cache:delete-module',
  CacheDeletePage: 'cache:delete-page',

  // 自动化
  TaskStart: 'task:start',
  TaskStop: 'task:stop',
  TaskState: 'task:state',
  ActionClickDetection: 'action:click-detection',

  // 标注 / 数据集
  AnnotateSave: 'annotate:save',
  DatasetInfo: 'dataset:info',
  ShellOpenUserData: 'shell:open-userdata',

  // 日志
  LogList: 'log:list',

  // 事件推送
  EvtTabs: 'evt:tabs',
  EvtDetect: 'evt:detect',
  EvtLog: 'evt:log',
  EvtModels: 'evt:models',
  EvtCache: 'evt:cache',
  EvtTask: 'evt:task',
  EvtPythonLog: 'evt:python-log'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
