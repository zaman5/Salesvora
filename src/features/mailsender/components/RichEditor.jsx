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
        gap: '4px',
        transition: 'all 0.15s'
      }}
    >
      {children}
    </button>
  );
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** A robust contentEditable-based rich text editor for compose, sequences and replies. */
export default function RichEditor({
  value,
  onChange,
  placeholder,
  style,
  minHeight = 140,
  attachments = [],
  onAttachmentsChange,
  allowAttachments = true,
}) {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  // Sync value from prop to editor (only if value differs from innerHTML to avoid resetting cursor)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== (value || '')) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (command, arg = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleLink = () => {
    const url = prompt('Enter link URL (e.g., https://example.com):');
    if (url) exec('createLink', url);
  };

  const handleImage = () => {
    const url = prompt('Enter image URL (e.g., https://example.com/logo.png):');
    if (url) exec('insertImage', url);
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach(file => {
      if (file.size > 20 * 1024 * 1024) {
        alert(`File "${file.name}" exceeds the 20MB limit.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result || '').toString().split(',')[1] || '';
        const newAttachment = {
          filename: file.name,
          content: base64,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        };
        if (onAttachmentsChange) {
          onAttachmentsChange([...(attachments || []), newAttachment]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeAttachment = (idx) => {
    if (onAttachmentsChange) {
      onAttachmentsChange((attachments || []).filter((_, i) => i !== idx));
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      overflow: 'hidden',
      background: 'var(--bg-primary)',
      ...style
    }}>
      {/* Hidden file input for attachment button */}
      <input
        type="file"
        multiple
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

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
        <ToolbarButton onClick={() => exec('strikeThrough')} title="Strikethrough"><s>S</s></ToolbarButton>
        <div style={{ width: 1, height: 16, background: 'var(--border-color)', margin: '0 4px' }} />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} title="Bullet List">• Bullet</ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} title="Numbered List">1. Number</ToolbarButton>
        <ToolbarButton onClick={() => exec('formatBlock', 'blockquote')} title="Quote">❝ Quote</ToolbarButton>
        <div style={{ width: 1, height: 16, background: 'var(--border-color)', margin: '0 4px' }} />
        <ToolbarButton onClick={handleLink} title="Insert Link">🔗 Link</ToolbarButton>
        <ToolbarButton onClick={handleImage} title="Insert Image">🖼️ Image</ToolbarButton>
        {allowAttachments && (
          <ToolbarButton onClick={() => fileInputRef.current?.click()} title="Attach Files">
            📎 Attach
          </ToolbarButton>
        )}
        <ToolbarButton onClick={() => exec('removeFormat')} title="Clear Formatting">🧹 Clean</ToolbarButton>
      </div>

      {/* Attachments preview bar */}
      {attachments && attachments.length > 0 && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--overlay-2)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          alignItems: 'center',
          fontSize: '0.78rem'
        }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            📎 Attachments ({attachments.length}):
          </span>
          {attachments.map((att, idx) => {
            const downloadUrl = att.content ? `data:${att.contentType || 'application/octet-stream'};base64,${att.content}` : null;
            return (
              <span
                key={idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--overlay-6)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '3px 8px',
                  color: 'var(--text-primary)'
                }}
              >
                <span>📄 {att.filename}</span>
                {att.size ? <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>({formatBytes(att.size)})</span> : null}
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download={att.filename || 'attachment'}
                    title="Download"
                    style={{ textDecoration: 'none', color: 'var(--accent-primary)', fontSize: '0.72rem' }}
                  >
                    ⬇
                  </a>
                )}
                {onAttachmentsChange && (
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '0 2px',
                      fontSize: '0.85rem',
                      lineHeight: 1
                    }}
                    title="Remove attachment"
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

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
          padding: '12px 14px',
          color: 'var(--text-primary)',
          fontSize: '0.92rem',
          lineHeight: 1.65,
          overflowY: 'auto',
          wordBreak: 'break-word',
          background: 'none'
        }}
      />
    </div>
  );
}
