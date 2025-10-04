export type AltRoute = { id: string; name: string; waypoints: string[] };

// 6 alternatives per Plant→CMO pair. Start with Bokaro→Delhi, then a few others.
export const ALT_ROUTES: Record<string, AltRoute[]> = {
  'Bokaro→Delhi': [
    { id: 'BKSC-DEL-1', name: 'Via Patna – Varanasi – Kanpur – Delhi', waypoints: ['Bokaro','Patna','Varanasi','Kanpur','Delhi'] },
    { id: 'BKSC-DEL-2', name: 'Via Asansol – Dhanbad – Kanpur – Delhi', waypoints: ['Bokaro','Asansol','Dhanbad','Kanpur','Delhi'] },
    { id: 'BKSC-DEL-3', name: 'Via Ranchi – Allahabad – Delhi', waypoints: ['Bokaro','Ranchi','Allahabad','Delhi'] },
    { id: 'BKSC-DEL-4', name: 'Via Gaya – Mughalsarai – Kanpur – Delhi', waypoints: ['Bokaro','Gaya','Mughalsarai','Kanpur','Delhi'] },
    { id: 'BKSC-DEL-5', name: 'Via Jamshedpur – Kanpur – Delhi', waypoints: ['Bokaro','Jamshedpur','Kanpur','Delhi'] },
    { id: 'BKSC-DEL-6', name: 'Via Durgapur – Lucknow – Delhi', waypoints: ['Bokaro','Durgapur','Lucknow','Delhi'] },
  ],
  'Bhilai→Mumbai': [
    { id: 'BSP-MUM-1', name: 'Bhilai – Nagpur – Bhusawal – Mumbai', waypoints: ['Bhilai','Nagpur','Bhusawal','Mumbai'] },
    { id: 'BSP-MUM-2', name: 'Bhilai – Raipur – Gondia – Bhusawal – Mumbai', waypoints: ['Bhilai','Raipur','Gondia','Bhusawal','Mumbai'] },
    { id: 'BSP-MUM-3', name: 'Bhilai – Durg – Itarsi – Mumbai', waypoints: ['Bhilai','Durg','Itarsi','Mumbai'] },
    { id: 'BSP-MUM-4', name: 'Bhilai – Nagpur – Wardha – Manmad – Mumbai', waypoints: ['Bhilai','Nagpur','Wardha','Manmad','Mumbai'] },
    { id: 'BSP-MUM-5', name: 'Bhilai – Raipur – Bilaspur – Gondia – Mumbai', waypoints: ['Bhilai','Raipur','Bilaspur','Gondia','Mumbai'] },
    { id: 'BSP-MUM-6', name: 'Bhilai – Durg – Khandwa – Mumbai', waypoints: ['Bhilai','Durg','Khandwa','Mumbai'] },
  ],
  'Rourkela→Kolkata': [
    { id: 'RSP-KOL-1', name: 'Rourkela – Tata Nagar – Kharagpur – Kolkata', waypoints: ['Rourkela','Tata Nagar','Kharagpur','Kolkata'] },
    { id: 'RSP-KOL-2', name: 'Rourkela – Jharsuguda – Kharagpur – Kolkata', waypoints: ['Rourkela','Jharsuguda','Kharagpur','Kolkata'] },
    { id: 'RSP-KOL-3', name: 'Rourkela – Dhenkanal – Cuttack – Kolkata', waypoints: ['Rourkela','Dhenkanal','Cuttack','Kolkata'] },
    { id: 'RSP-KOL-4', name: 'Rourkela – Angul – Bhubaneswar – Kolkata', waypoints: ['Rourkela','Angul','Bhubaneswar','Kolkata'] },
    { id: 'RSP-KOL-5', name: 'Rourkela – Ranchi – Asansol – Kolkata', waypoints: ['Rourkela','Ranchi','Asansol','Kolkata'] },
    { id: 'RSP-KOL-6', name: 'Rourkela – Tata Nagar – Durgapur – Kolkata', waypoints: ['Rourkela','Tata Nagar','Durgapur','Kolkata'] },
  ],
  'Durgapur→Delhi': [
    { id: 'DGR-DEL-1', name: 'Durgapur – Asansol – Varanasi – Delhi', waypoints: ['Durgapur','Asansol','Varanasi','Delhi'] },
    { id: 'DGR-DEL-2', name: 'Durgapur – Dhanbad – Kanpur – Delhi', waypoints: ['Durgapur','Dhanbad','Kanpur','Delhi'] },
    { id: 'DGR-DEL-3', name: 'Durgapur – Patna – Mughalsarai – Delhi', waypoints: ['Durgapur','Patna','Mughalsarai','Delhi'] },
    { id: 'DGR-DEL-4', name: 'Durgapur – Ranchi – Kanpur – Delhi', waypoints: ['Durgapur','Ranchi','Kanpur','Delhi'] },
    { id: 'DGR-DEL-5', name: 'Durgapur – Gaya – Allahabad – Delhi', waypoints: ['Durgapur','Gaya','Allahabad','Delhi'] },
    { id: 'DGR-DEL-6', name: 'Durgapur – Asansol – Lucknow – Delhi', waypoints: ['Durgapur','Asansol','Lucknow','Delhi'] },
  ],
  'Burnpur→Patna': [
    { id: 'ISP-PAT-1', name: 'Burnpur – Durgapur – Asansol – Patna', waypoints: ['Burnpur','Durgapur','Asansol','Patna'] },
    { id: 'ISP-PAT-2', name: 'Burnpur – Ranchi – Gaya – Patna', waypoints: ['Burnpur','Ranchi','Gaya','Patna'] },
    { id: 'ISP-PAT-3', name: 'Burnpur – Asansol – Dhanbad – Patna', waypoints: ['Burnpur','Asansol','Dhanbad','Patna'] },
    { id: 'ISP-PAT-4', name: 'Burnpur – Durgapur – Varanasi – Patna', waypoints: ['Burnpur','Durgapur','Varanasi','Patna'] },
    { id: 'ISP-PAT-5', name: 'Burnpur – Ranchi – Hazaribagh – Patna', waypoints: ['Burnpur','Ranchi','Hazaribagh','Patna'] },
    { id: 'ISP-PAT-6', name: 'Burnpur – Asansol – Jhajha – Patna', waypoints: ['Burnpur','Asansol','Jhajha','Patna'] },
  ],
};

export function keyFor(plant: string, cmo: string){ return `${plant}→${cmo}`; }
