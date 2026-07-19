"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { directionsUrlFor } from "./directions";
import { FAN_MAP_HEIGHT } from "./fan-map-constants";

export type FanMapLocation = {
  id: string;
  location_name: string;
  lat: number;
  lng: number;
};

// A plain dot in the fan page's own accent colour — no ordinal badges, no
// geofence circle. Fans don't need to see the unlock boundary; they just
// need to find the spot.
function markerIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="fan-map-marker"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function MapReady({ onReady }: { onReady: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

function FitToMarkers({ locations }: { locations: FanMapLocation[] }) {
  const map = useMap();
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || !locations.length) return;
    didFit.current = true;
    if (locations.length === 1) {
      map.setView([locations[0].lat, locations[0].lng], 15);
    } else {
      map.fitBounds(
        L.latLngBounds(locations.map((l) => [l.lat, l.lng] as [number, number])),
        { padding: [32, 32], maxZoom: 15 }
      );
    }
  }, [locations, map]);
  return null;
}

export default function FanMap({
  locations,
  focusedId,
  focusNonce,
}: {
  locations: FanMapLocation[];
  // Tapping a location in the list sets these; a nonce (not just the id)
  // means re-tapping the same spot after panning away still re-triggers —
  // an id-only effect dependency would bail out on a same-value update.
  focusedId: string | null;
  focusNonce: number;
}) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Record<string, L.Marker | null>>({});

  useEffect(() => {
    if (!focusedId) return;
    const loc = locations.find((l) => l.id === focusedId);
    const marker = markerRefs.current[focusedId];
    const m = mapRef.current;
    if (!loc || !m) return;
    m.panTo([loc.lat, loc.lng]);
    marker?.openPopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, focusedId]);

  if (!locations.length) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-ink/25">
      <MapContainer
        center={[locations[0].lat, locations[0].lng]}
        zoom={14}
        style={{ height: FAN_MAP_HEIGHT, width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <MapReady onReady={(m) => (mapRef.current = m)} />
        <FitToMarkers locations={locations} />
        {locations.map((l) => (
          <Marker
            key={l.id}
            position={[l.lat, l.lng]}
            icon={markerIcon()}
            ref={(instance) => {
              markerRefs.current[l.id] = instance;
            }}
          >
            <Popup>
              <div className="text-center">
                <p className="font-medium text-ink">{l.location_name}</p>
                <a
                  href={directionsUrlFor(l)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block rounded-full bg-forest-deep px-4 py-1.5 text-xs font-semibold text-parchment"
                >
                  Directions
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
