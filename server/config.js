/** 服务端默认配置（仅作 API 缺省值，不写入磁盘） */
const DEFAULT_CONFIG = {
  favorites: [],
  recentPaths: [],
  settings: {
    compareMode: 'md5',
    ignorePatterns: ['.DS_Store', '.git', 'node_modules', '.stignore'],
    defaultSyncStrategy: 'primary-overwrite',
  },
  lastSession: {
    folders: [],
    compareMode: 'md5',
  },
};

module.exports = { DEFAULT_CONFIG };
