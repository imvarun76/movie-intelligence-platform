import { useEffect, useState } from "react";

type HealthResponse = {
  status: string;
};

function App() {
  const [backendStatus, setBackendStatus] = useState("Checking backend...");

  useEffect(() => {
    fetch("http://127.0.0.1:8000/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Backend request failed");
        }

        return response.json() as Promise<HealthResponse>;
      })
      .then((data) => {
        setBackendStatus(`Backend status: ${data.status}`);
      })
      .catch(() => {
        setBackendStatus("Backend unavailable");
      });
  }, []);

  return (
    <main>
      <h1>Movie Intelligence Platform</h1>
      <p>{backendStatus}</p>
    </main>
  );
}

export default App;