// Deutsch ist die Basissprache: die deutschen Quelltexte sind zugleich die
// Übersetzungsschlüssel. Daher ist dieses Wörterbuch leer — tt('…deutscher
// Text…') liefert den Text direkt zurück. Apps/Plugins können über
// registerMessages('de', {…}) eigene Einträge ergänzen.
export const de: Record<string, string> = {};
