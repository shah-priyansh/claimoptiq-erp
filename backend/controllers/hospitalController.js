const Hospital = require('../models/Hospital');

const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
const isValidPincode = (v) => /^[1-9][0-9]{5}$/.test((v || '').trim());

const validateHospitalFields = (body) => {
  if (body.phone && !isValidPhone(body.phone)) return 'Enter a valid 10-digit Indian mobile number (starts with 6-9)';
  if (body.email && !isValidEmail(body.email)) return 'Enter a valid email address';
  if (body.pincode && !isValidPincode(body.pincode)) return 'Enter a valid 6-digit Indian pincode';
  return null;
};

exports.createHospital = async (req, res) => {
  try {
    const err = validateHospitalFields(req.body);
    if (err) return res.status(400).json({ message: err });
    const hospital = await Hospital.create(req.body);
    res.status(201).json(hospital);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospitals = async (req, res) => {
  try {
    const { search, active } = req.query;
    const filter = {};
    if (active !== undefined) filter.isActive = active === 'true';
    if (search) filter.name = { $regex: search, $options: 'i' };

    // Hospital-linked users can only see their own hospital
    if (req.user.hospital) {
      filter._id = req.user.hospital._id || req.user.hospital;
    }

    const hospitals = await Hospital.find(filter).sort('name');
    res.json(hospitals);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospital = async (req, res) => {
  try {
    // Hospital-linked users can only view their own hospital
    if (req.user.hospital) {
      const userHospitalId = (req.user.hospital._id || req.user.hospital).toString();
      if (req.params.id !== userHospitalId) {
        return res.status(403).json({ message: 'You can only view your own hospital' });
      }
    }

    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });
    res.json(hospital);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateHospital = async (req, res) => {
  try {
    const err = validateHospitalFields(req.body);
    if (err) return res.status(400).json({ message: err });
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });
    res.json(hospital);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteHospital = async (req, res) => {
  try {
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });
    res.json({ message: 'Hospital deactivated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
