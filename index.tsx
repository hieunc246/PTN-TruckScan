import { useState } from 'react';

export default function Home() {
  const [login, setLogin] = useState({ id: '', password: '' });
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    maPhieu:'', ngay:'', gio:'', loaiPT:'', bienSo:'', khoiLuong:'', loaiHang:'', toaDo:'', viTri:''
  });

  const handleLoginChange = (e:any) => setLogin({ ...login, [e.target.name]: e.target.value });
  const handleFormChange = (e:any) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleLogin = async (e:any) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(login)
    });
    const data = await res.json();
    setMessage(data.message);
  };

  const handleSubmit = async (e:any) => {
    e.preventDefault();
    const res = await fetch('/api/saveDApp', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form)
    });
    const data = await res.json();
    setMessage(data.message);
  };

  return (
    <div style={{padding:'20px'}}>
      <h1>TruckScan App</h1>
      
      <h2>Login</h2>
      <form onSubmit={handleLogin}>
        <input type="text" name="id" placeholder="ID" value={login.id} onChange={handleLoginChange} />
        <input type="password" name="password" placeholder="Mật khẩu" value={login.password} onChange={handleLoginChange} />
        <button type="submit">Login</button>
      </form>

      <h2>Ghi dữ liệu xe</h2>
      <form onSubmit={handleSubmit}>
        {Object.keys(form).map(k=>(
          <div key={k}><input name={k} placeholder={k} value={(form as any)[k]} onChange={handleFormChange} /></div>
        ))}
        <button type="submit">Save</button>
      </form>

      <p>{message}</p>
    </div>
  )
}