import { useState } from 'react';
import { Map as MapIcon, List, Settings, Globe } from 'lucide-react';
import MapBoard from './components/MapBoard';
import Sidebar from './components/Sidebar';
import type { Disaster } from './types';

function App() {
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [activeTab, setActiveTab] = useState('map');

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-black flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 bg-gray-900/80 backdrop-blur-md border-b border-white/10 z-50 absolute top-0 w-full">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center">
            <Globe size={20} className="text-white" />
          </div>
          <h1 className="text-lg md:text-xl font-bold text-white tracking-tight">AegisMap</h1>
        </div>

        <nav className="hidden md:flex items-center gap-6">
          <button className="px-4 py-2 rounded-full bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-all">Map</button>
          <button className="text-gray-400 hover:text-white text-sm font-medium transition-colors">Disasters</button>
          <button className="text-gray-400 hover:text-white text-sm font-medium transition-colors">Satellites</button>
          <button className="text-gray-400 hover:text-white text-sm font-medium transition-colors">About</button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative">
        <MapBoard onDisasterSelect={setSelectedDisaster} />

        {selectedDisaster && (
          <Sidebar
            disaster={selectedDisaster}
            onClose={() => setSelectedDisaster(null)}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden flex items-center justify-around px-6 py-4 bg-gray-900/90 backdrop-blur-md border-t border-white/10 z-50 fixed bottom-0 w-full">
        <button
          onClick={() => setActiveTab('map')}
          className={`flex flex-col items-center gap-1 ${activeTab === 'map' ? 'text-blue-400' : 'text-gray-500'}`}
        >
          <MapIcon size={24} />
          <span className="text-[10px] font-medium">Map</span>
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`flex flex-col items-center gap-1 ${activeTab === 'list' ? 'text-blue-400' : 'text-gray-500'}`}
        >
          <List size={24} />
          <span className="text-[10px] font-medium">List</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 ${activeTab === 'settings' ? 'text-blue-400' : 'text-gray-500'}`}
        >
          <Settings size={24} />
          <span className="text-[10px] font-medium">Settings</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
