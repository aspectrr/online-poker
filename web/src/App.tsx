import { Route, Router } from '@solidjs/router'
import { LobbyPage } from './pages/Lobby'
import { AuthPage } from './pages/Auth'

function App() {
  return (
    <Router>
      <Route path="/" component={LobbyPage} />
      <Route path="/auth" component={AuthPage} />
    </Router>
  )
}

export default App
