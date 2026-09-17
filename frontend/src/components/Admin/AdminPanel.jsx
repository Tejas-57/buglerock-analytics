// frontend/src/components/Admin/AdminPanel.jsx
// Only visible to admin users

import { useState, useEffect } from "react";
import "./AdminPanel.css";

const API = process.env.REACT_APP_API_URL;

export default function AdminPanel() {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/auth/users`, { credentials: "include" });
      const data = await res.json();
      setUsers(data);
    } catch {
      setMessage("Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function action(url, successMsg) {
    try {
      const res = await fetch(`${API}${url}`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setMessage(successMsg);
      fetchUsers();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>User Management</h2>
        <span className="admin-count">{users.length} users</span>
      </div>

      {message && (
        <div className="admin-message" onClick={() => setMessage("")}>
          {message} <span style={{ float: "right", cursor: "pointer" }}>×</span>
        </div>
      )}

      {loading ? (
        <p className="admin-loading">Loading users…</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Password</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={!u.is_active ? "row-inactive" : ""}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <span className={`badge badge-${u.role}`}>{u.role}</span>
                </td>
                <td>
                  <span className={`badge badge-${u.is_active ? "active" : "inactive"}`}>
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <span className={`badge badge-${u.password_set ? "set" : "pending"}`}>
                    {u.password_set ? "Set" : "Pending"}
                  </span>
                </td>
                <td className="admin-actions">
                  {u.is_active && (
                    <button
                      className="btn-action btn-revoke"
                      onClick={() => action(`/api/auth/users/${u.id}/revoke`, `Sessions revoked for ${u.name}`)}
                      title="Log them out of all devices"
                    >
                      Revoke sessions
                    </button>
                  )}
                  {u.is_active && !u.password_set && (
                    <button
                      className="btn-action btn-resend"
                      onClick={() => action(`/api/auth/users/${u.id}/resend-setup`, `Setup email resent to ${u.email}`)}
                      title="Resend the account setup email"
                    >
                      Resend setup
                    </button>
                  )}
                  {u.is_active && (
                    <button
                      className="btn-action btn-deactivate"
                      onClick={() => {
                        if (window.confirm(`Deactivate ${u.name}? They will be logged out immediately.`)) {
                          action(`/api/auth/users/${u.id}/deactivate`, `${u.name} deactivated`);
                        }
                      }}
                      title="Deactivate account — blocks all future logins"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
