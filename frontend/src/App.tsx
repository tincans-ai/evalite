import { BrowserRouter as Router, Route, Link, Routes, } from 'react-router-dom';
import WorkspaceList from "@/pages/ListWorkspaces.tsx";
import WorkspacePage from "@/pages/WorkspacePage.tsx";
import NewWorkspace from "@/pages/NewWorkspace.tsx";

const App = () => {
  return (
      <Router>
        <div className="min-h-screen bg-gray-100">
          <nav className="bg-white shadow-sm">
            <div className="mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex">
                  <Link to="/" className="flex-shrink-0 flex items-center">
                    Evalite
                  </Link>
                </div>
              </div>
            </div>
          </nav>

          <div className="py-10">
            <main>
              <div className="mx-auto sm:px-6 lg:px-8">
                <Routes>
                  <Route path="/" element={<WorkspaceList />} />
                  <Route path="/workspaces/new" element={< NewWorkspace/>} />
                  <Route path="/workspaces/:workspaceId" element={<WorkspacePage />} />
                </Routes>
              </div>
            </main>
          </div>
        </div>
      </Router>
  );
};

export default App;