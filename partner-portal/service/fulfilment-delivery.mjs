const fail=()=>{throw Object.assign(Error('confirmed_delivery_address_required'),{status:422});};
const clean=value=>typeof value==='string'?value.trim():'';
export function requireDelivery(delivery){
 if(!delivery||!['address','postcode'].every(key=>{const value=clean(delivery[key]);return value&&value.length<=2000&&!/[\u0000-\u001f\u007f]/.test(value);}))fail();
 return delivery;
}
// Use the immutable assessment that the current prescription is bound to.
// A partly entered alternative address must never silently become the home address.
export function deliveryFromAssessment(answers){
 const address=clean(answers?.deliveryAddress),postcode=clean(answers?.deliveryPostcode);
 if(Boolean(address)!==Boolean(postcode))fail();
 return requireDelivery({name:clean(answers?.fullName),address:address||clean(answers?.address),postcode:postcode||clean(answers?.postcode),source:address?'member_delivery_address':'member_home_address'});
}
