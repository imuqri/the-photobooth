import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import Room from "./pages/Room.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/room/:code" element={<Room />} />
    </Routes>
  );
}
