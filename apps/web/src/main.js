import { createApp } from 'vue'
import { help } from './help.js'
import App from './App.vue'
import './style.css'

createApp(App).directive('help', help).mount('#app')
