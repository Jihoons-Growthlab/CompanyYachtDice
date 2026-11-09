// One shared tooltip keeps help visible outside scrolling spreadsheet cells.
export const help = {
  mounted(el, binding) {
    let tooltip
    const hide = () => {
      tooltip?.remove()
      tooltip = null
      el.removeAttribute('aria-describedby')
    }
    const show = () => {
      hide()
      if (!el.dataset.help) return
      tooltip = document.createElement('div')
      tooltip.id = 'active-control-help'
      tooltip.className = 'control-help'
      tooltip.setAttribute('role', 'tooltip')
      tooltip.textContent = el.dataset.help
      document.body.append(tooltip)
      el.setAttribute('aria-describedby', tooltip.id)
      const rect = el.getBoundingClientRect()
      tooltip.style.left = Math.max(8, Math.min(rect.left, innerWidth - tooltip.offsetWidth - 8)) + 'px'
      const below = rect.bottom + 8
      tooltip.style.top = (below + tooltip.offsetHeight < innerHeight ? below : Math.max(8, rect.top - tooltip.offsetHeight - 8)) + 'px'
    }
    const escape = event => { if (event.key === 'Escape') hide() }
    el.dataset.help = binding.value
    el.addEventListener('mouseenter', show)
    el.addEventListener('mouseleave', hide)
    el.addEventListener('focus', show)
    el.addEventListener('blur', hide)
    el.addEventListener('click', hide)
    el.addEventListener('keydown', escape)
    el._disposeHelp = () => {
      hide()
      el.removeEventListener('mouseenter', show)
      el.removeEventListener('mouseleave', hide)
      el.removeEventListener('focus', show)
      el.removeEventListener('blur', hide)
      el.removeEventListener('click', hide)
      el.removeEventListener('keydown', escape)
    }
  },
  updated(el, binding) { el.dataset.help = binding.value },
  unmounted(el) { el._disposeHelp() },
}
