import React, { useState, useRef, useEffect } from 'react';

const ToolbarButton = ({ onClick, children, title }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      style={{
        background: hovered ? 'var(--overlay-8)' : 'none',
        border: 'none',
        color: hovered ? 'var(--accent-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        padding: '5px 8px',
        borderRadius: 4,
        fontWeight: 'bold',
        fontSize: '0.82rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s'
      }}
    >
      {children}
    </button>
  );
};

/** A small contentEditable-based rich text editor (bold/italic/underline/link/image). */
export default function RichEditor({ value, onChange, placeholder, style, minHeight = 120 }) {
  const editorRef = useRef(null);

  // Sync value from prop to editor (only if value differs from innerHTML to avoid resetting cursor)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (command, arg = null) => {
    document.execCommand(command, false, arg);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleLink = () => {
    const url = prompt('Enter link URL (e.g., https://google.com):');
    if (url) exec('createLink', url);
  };

  const handleImage = () => {
    const url = prompt('Enter image URL (e.g., https://example.com/pic.png):');
    if (url) exec('insertImage', url);
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      overflow: 'hidden',
      background: 'var(--overlay-1)',
      ...style
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.2rem',
        padding: '6px 10px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--overlay-3)',
        flexWrap: 'wrap'
      }}>
        <ToolbarButton onClick={() => exec('bold')} title="Bold"><b>B</b></ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} title="Italic"><i>I</i></ToolbarButton>
        <ToolbarButton onClick={() => exec('underline')} title="Underline"><u>U</u></ToolbarButton>
        <div style={{ width: 1, height: 16, background: 'var(--border-color)', margin: '0 4px' }} />
        <ToolbarButton onClick={handleLink} title="Insert Link">🔗</ToolbarButton>
        <ToolbarButton onClick={handleImage} title="Insert Image">🖼️</ToolbarButton>
        <ToolbarButton onClick={() => exec('removeFormat')} title="Clear Formatting">🧹</ToolbarButton>
      </div>

      {/* Editor Content */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        className="rich-editor-content"
        placeholder={placeholder}
        style={{
          flex: 1,
          minHeight,
          outline: 'none',
          padding: '10px 14px',
          color: 'var(--text-primary)',
          fontSize: '0.9rem',
          lineHeight: 1.6,
          overflowY: 'auto',
          wordBreak: 'break-word',
          background: 'none'
        }}
      />
    </div>
  );
}
