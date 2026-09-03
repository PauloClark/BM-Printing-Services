export const showToast = (message, type = 'info') => {
  // Simple toast notification implementation
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: #333;
    color: #fff;
    border-radius: 4px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 3000);
};