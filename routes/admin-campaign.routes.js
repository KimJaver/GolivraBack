const express = require('express');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');
const {
  getCampagnesList,
  getCampagneDetail,
  postCampagne,
  patchCampagne,
  removeCampagne,
} = require('../controllers/admin-campaign.controller');

const router = express.Router();
const adminOnly = [authMiddleware, requireRoles(['admin'])];

router.get('/campagnes', ...adminOnly, getCampagnesList);
router.get('/campagnes/:campagneId', ...adminOnly, getCampagneDetail);
router.post('/campagnes', ...adminOnly, postCampagne);
router.patch('/campagnes/:campagneId', ...adminOnly, patchCampagne);
router.delete('/campagnes/:campagneId', ...adminOnly, removeCampagne);

module.exports = router;
