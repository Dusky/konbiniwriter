// icons.jsx — minimal stroked icon set (16px grid). Exported to window.
const _i = (paths, props) => (p) => (
  React.createElement('svg', Object.assign({
    viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
  }, props, p), paths)
);

const Icons = {
  Chevron:  _i(<path d="M6 4l4 4-4 4" />),
  Folder:   _i(<path d="M2 4.5A1.5 1.5 0 013.5 3h2.8a1 1 0 01.8.4l.7.9a1 1 0 00.8.4h3.9A1.5 1.5 0 0114 6.2V11.5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5z" />),
  FolderOpen: _i(<g><path d="M2 5.5A1.5 1.5 0 013.5 4h2.6a1 1 0 01.8.4l.6.8a1 1 0 00.8.4h4.2A1.5 1.5 0 0114 7.1" /><path d="M2.4 12.6l1.3-4.2A1 1 0 014.65 7.7h9.1a1 1 0 01.95 1.3l-1 3.3a1 1 0 01-.95.7H3.35a1 1 0 01-.95-.4z" /></g>),
  Doc:      _i(<g><path d="M4 2.5h4.5L12 6v7.5A1 1 0 0111 14.5H4A1 1 0 013 13.5v-10A1 1 0 014 2.5z" /><path d="M8.5 2.5V6H12" /></g>),
  Scene:    _i(<g><rect x="2.5" y="3" width="11" height="10" rx="1.3" /><path d="M2.5 6.2h11" /><path d="M5.4 3v3.2M10.6 3v3.2" /></g>),
  Trash:    _i(<g><path d="M3 4.5h10" /><path d="M5.5 4.5V3.2A1 1 0 016.5 2.2h3A1 1 0 0110.5 3.2V4.5" /><path d="M4.2 4.5l.6 8A1 1 0 005.8 13.5h4.4a1 1 0 001-1l.6-8" /></g>),
  Plus:     _i(<path d="M8 3.5v9M3.5 8h9" />),
  NewDoc:   _i(<g><path d="M4 2.5h4L11 5.5V10" /><path d="M3 13.5h.01" /><path d="M8.5 2.5V5.5H11" /><path d="M11.5 11v4M9.5 13h4" /></g>),
  NewFolder:_i(<g><path d="M2 4.5A1.5 1.5 0 013.5 3h2.8a1 1 0 01.8.4l.7.9a1 1 0 00.8.4H10" /><path d="M2 6v5.5A1.5 1.5 0 003.5 13h6" /><path d="M12 9v4M10 11h4" /></g>),
  Edit:     _i(<g><path d="M3 13h10" /><path d="M4 11l6.5-6.5a1.4 1.4 0 012 2L6 13l-2.5.5z" /></g>),
  Cork:     _i(<g><rect x="2.5" y="2.5" width="5" height="5" rx="1" /><rect x="8.5" y="2.5" width="5" height="5" rx="1" /><rect x="2.5" y="8.5" width="5" height="5" rx="1" /><rect x="8.5" y="8.5" width="5" height="5" rx="1" /></g>),
  Outline:  _i(<g><path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" /></g>),
  Expand:   _i(<path d="M9 3h4v4M13 3l-4.5 4.5M7 13H3V9M3 13l4.5-4.5" />),
  Camera:   _i(<g><path d="M2.5 5.5A1 1 0 013.5 4.5h1.2l.8-1.3h5l.8 1.3h1.2a1 1 0 011 1V12a1 1 0 01-1 1H3.5a1 1 0 01-1-1z" /><circle cx="8" cy="8.3" r="2.3" /></g>),
  Compile:  _i(<g><path d="M3.5 2.5h6L12.5 5.5v8a.5.5 0 01-.5.5H3.5a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5z" /><path d="M9 2.5V5.5h3.5" /><path d="M5.5 8.5h5M5.5 11h3" /></g>),
  Insp:     _i(<g><rect x="2.5" y="3" width="11" height="10" rx="1.2" /><path d="M10 3v10" /></g>),
  Sidebar:  _i(<g><rect x="2.5" y="3" width="11" height="10" rx="1.2" /><path d="M6 3v10" /></g>),
  Dup:      _i(<g><rect x="5" y="5" width="8" height="8" rx="1.2" /><path d="M3 9.5V4A1 1 0 014 3h5.5" /></g>),
  Dot:      _i(<circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />),
  Search:   _i(<g><circle cx="7" cy="7" r="4" /><path d="M10 10l3 3" /></g>),
  Book:     _i(<path d="M3 3.5A1 1 0 014 2.5h8a.5.5 0 01.5.5v9a.5.5 0 01-.5.5H4.5A1.5 1.5 0 003 13.5zM3 13.5A1.5 1.5 0 014.5 12H12.5" />),
  Restore:  _i(<g><path d="M3 8a5 5 0 105-5 5 5 0 00-4 2" /><path d="M3 3v2.5h2.5" /><path d="M8 5.5V8l1.8 1.1" /></g>),
  Check:    _i(<path d="M3.5 8.5l3 3 6-7" />),
  Focus:    _i(<g><circle cx="8" cy="8" r="2" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2" /></g>),
};
window.Icons = Icons;
