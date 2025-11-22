import { useState } from 'react';
import MapBoard from './components/MapBoard';
import Sidebar from './components/Sidebar';
import type { Disaster } from './types';

function App() {
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);

  return (
    <div className="w-screen h-screen relative overflow-hidden">
      <MapBoard onDisasterSelect={setSelectedDisaster} />
      {selectedDisaster && (
        <Sidebar
          disaster={selectedDisaster}
          onClose={() => setSelectedDisaster(null)}
        />
      )}
    </div>
  );
}

export default App;
