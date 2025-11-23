import { useState, useEffect } from 'react';
import { Globe, Menu, X } from 'lucide-react';
import MapBoard from './components/MapBoard';
import Sidebar from './components/Sidebar';
import DebugPanel from './components/DebugPanel';
import type { Disaster } from './types';

function App() {
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Debug: Log state changes
  useEffect(() => {
    console.log('🔍 selectedDisaster state changed:', selectedDisaster);
  }, [selectedDisaster]);

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-black flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-gray-900/70 backdrop-blur-md border-b border-white/5 z-50 relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center">
            <Globe size={20} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">AegisMap</h1>
        </div>

        {/* Desktop Navigation - simple text links */}
        <nav className="desktop-nav flex items-center gap-8">
          <button className="text-gray-300 text-sm font-medium hover:text-white transition-colors">Map</button>
          <button className="text-white text-sm font-medium hover:text-blue-400 transition-colors">Disasters</button>
          <button className="text-gray-300 text-sm font-medium hover:text-white transition-colors">Satellites</button>
          <button className="text-gray-300 text-sm font-medium hover:text-white transition-colors">About</button>
        </nav>

        {/* Mobile Hamburger Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-btn p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Navigation Overlay */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Slide-in Menu */}
          <nav className="fixed top-0 right-0 h-full w-64 bg-gray-900/95 backdrop-blur-xl border-l border-white/10 z-50 md:hidden shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="flex flex-col h-full">
              {/* Menu Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-lg font-bold text-white">Menu</h2>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Menu Items */}
              <div className="flex-1 px-4 py-6 space-y-2">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full px-4 py-3 text-left text-gray-300 hover:text-white hover:bg-white/10 rounded-lg font-medium transition-all"
                >
                  Map
                </button>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full px-4 py-3 text-left text-white bg-white/10 rounded-lg font-medium hover:bg-white/20 transition-all"
                >
                  Disasters
                </button>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full px-4 py-3 text-left text-gray-300 hover:text-white hover:bg-white/10 rounded-lg font-medium transition-all"
                >
                  Satellites
                </button>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full px-4 py-3 text-left text-gray-300 hover:text-white hover:bg-white/10 rounded-lg font-medium transition-all"
                >
                  About
                </button>
              </div>
            </div>
          </nav>
        </>
      )}

      {/* Main Content Area */}
      <main className="flex-1 relative">
        <MapBoard onDisasterSelect={setSelectedDisaster} />
      </main>

      {/* Sidebar - outside main container for proper positioning */}
      {selectedDisaster && (
        <Sidebar
          disaster={selectedDisaster}
          onClose={() => {
            console.log('🔒 Closing sidebar');
            setSelectedDisaster(null);
          }}
        />
      )}

      {/* Debug Panel */}
      <DebugPanel />
    </div>
  );
}

export default App;
