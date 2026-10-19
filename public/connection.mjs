// Only definitive room/session failures end recovery. Ordinary turn conflicts,
// rate limits and network/server failures must retain the current seat.
export function terminalRoomFailure(result){
  if(result.ok)return null;
  if(result.status===404)return {kind:'room',title:'Table unavailable',message:'This table has expired or no longer exists. Create a new table or join a different invite.'};
  if(result.status===401||result.status===403&&result.value?.errorCode==='seat_missing')return {kind:'seat',title:'Seat unavailable',message:'This tab no longer has a valid seat. Use your original browser tab, or create or join another table.'};
  return null;
}
