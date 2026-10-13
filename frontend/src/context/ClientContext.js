import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ClientContext = createContext(null);

const API = process.env.REACT_APP_API_URL || '';

export function ClientProvider({ children }) {
  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClientState] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load all clients on mount
  const fetchClients = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/clients`, { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      setClients(data.clients || []);
      // Restore active client from localStorage
      const savedId = localStorage.getItem('br_active_client_id');
      if (savedId) {
        const found = (data.clients || []).find(c => c.id === savedId);
        if (found) setActiveClientState(found);
      }
    } catch (e) {
      console.warn('ClientContext: fetch failed', e);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const setActiveClient = useCallback((client) => {
    setActiveClientState(client);
    if (client) {
      localStorage.setItem('br_active_client_id', client.id);
    } else {
      localStorage.removeItem('br_active_client_id');
    }
  }, []);

  const createClient = useCallback(async (data) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/clients`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error('Failed to create client');
      const client = await r.json();
      setClients(prev => [client, ...prev]);
      setActiveClient(client);
      return client;
    } finally {
      setLoading(false);
    }
  }, [setActiveClient]);

  const updateClient = useCallback(async (id, data) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/clients/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error('Failed to update client');
      const updated = await r.json();
      setClients(prev => prev.map(c => c.id === id ? updated : c));
      if (activeClient?.id === id) setActiveClientState(updated);
      return updated;
    } finally {
      setLoading(false);
    }
  }, [activeClient]);

  const deleteClient = useCallback(async (id) => {
    await fetch(`${API}/api/clients/${id}`, { method: 'DELETE', credentials: 'include' });
    setClients(prev => prev.filter(c => c.id !== id));
    if (activeClient?.id === id) setActiveClient(null);
  }, [activeClient, setActiveClient]);

  return (
    <ClientContext.Provider value={{
      clients, activeClient, loading,
      setActiveClient, createClient, updateClient, deleteClient, fetchClients,
    }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient must be used within ClientProvider');
  return ctx;
}