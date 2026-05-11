const Hospital = require('../models/Hospital');

exports.createHospital = async (req, res) => {
  try {
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
