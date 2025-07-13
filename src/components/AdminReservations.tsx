
import { useState, useEffect } from 'react';
import { supabase } from '../integrations/supabase/client';

interface Reservation {
  id: string;
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  guests: number;
  message?: string | null;
  status: 'booked' | 'attended' | 'no_show';
  created_at: string;
}

const AdminReservations = () => {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
    try {
      const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .order('date', { ascending: true })
        .order('time', { ascending: true });

      if (error) throw error;
      setReservations(data || []);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateReservationStatus = async (reservationId: string, status: 'booked' | 'attended' | 'no_show') => {
    try {
      await supabase
        .from('reservations')
        .update({ status })
        .eq('id', reservationId);

      fetchReservations();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl">Loading reservations...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Via Bianca - Reservation Management</h1>
          <p className="mt-2 text-gray-600">Manage your restaurant reservations</p>
        </div>

        {reservations.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-500">No reservations found.</p>
          </div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Guest Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reservation
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reservations.map((reservation) => (
                    <tr key={reservation.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{reservation.name}</div>
                          <div className="text-sm text-gray-500">{reservation.email}</div>
                          <div className="text-sm text-gray-500">{reservation.phone}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {new Date(reservation.date).toLocaleDateString()} at {reservation.time}
                          </div>
                          <div className="text-sm text-gray-500">{reservation.guests} guests</div>
                          {reservation.message && (
                            <div className="text-sm text-gray-500 mt-1">"{reservation.message}"</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={reservation.status}
                          onChange={(e) => updateReservationStatus(reservation.id, e.target.value as any)}
                          className={`text-sm rounded-full px-3 py-1 border ${
                            reservation.status === 'booked' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                            reservation.status === 'attended' ? 'bg-green-100 text-green-800 border-green-200' :
                            'bg-red-100 text-red-800 border-red-200'
                          }`}
                        >
                          <option value="booked">Booked</option>
                          <option value="attended">Attended</option>
                          <option value="no_show">No Show</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminReservations;
